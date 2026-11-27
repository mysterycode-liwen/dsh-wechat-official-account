/**
 * 微信公众号管理插件 — Host 半边。
 *
 * - 从凭据保险箱读取 AppID / AppSecret（只存密文，不写 config）。
 * - 业务能力集中在 wechat 服务对象，供两类调用者共用：
 *   1) Client 面板通过 /api/wechat/* HTTP 路由调用（同一套实现）；
 *   2) Agent 工具 wechat_* 调用同一服务对象。
 * - 微信接口调用只在 Host 侧发起，Client 不直接接触密钥。
 */

import { WeChatClient, WeChatApiError } from './wechat-api.js';

// CredentialKey is a branded string at runtime ("<scope>/<id>"); both segments
// match ^[a-z][a-z0-9-]*$. Using the plain form avoids a runtime import of
// @deepseek-ai/dsh-credentials, which a workspace-linked bundle cannot resolve.
const CRED_KEY = 'wechat-official-account/account';
const PANEL_ID = 'wechat';
const API_PREFIX = '/api/wechat';

function readCredential(record) {
	if (!record || record.kind !== 'api-key') return null;
	const appId = record.env?.WECHAT_APP_ID || record.key?.trim();
	const secret = record.key?.trim();
	if (!appId || !secret) return null;
	// key 存 AppSecret，env.WECHAT_APP_ID 存 AppID；兼容仅把 appid:secret 写在 key 的情况。
	const combined = /^([^:\s]+):(.+)$/.exec(secret);
	if (combined && !record.env?.WECHAT_APP_ID) return { appId: combined[1], appSecret: combined[2] };
	return { appId, appSecret: secret };
}

function createService(ctx) {
	const credentials = ctx.credentials;

	async function config() {
		const record = await credentials.readRecord(CRED_KEY);
		return {
			configured: !!record,
			credential: await credentials.describeRecord(CRED_KEY),
		};
	}

	function clientFrom(record) {
		const parsed = readCredential(record);
		if (!parsed) throw new Error('凭据不完整。请在侧边栏凭据保险箱中配置「微信公众号」：key 填 AppSecret，env 添加 WECHAT_APP_ID=你的AppID（也可把 key 写成 AppID:AppSecret）。');
		return new WeChatClient(parsed.appId, parsed.appSecret, globalThis.fetch);
	}

	async function withClient(fn) {
		const record = await credentials.readRecord(CRED_KEY);
		const client = clientFrom(record);
		return fn(client);
	}

	return {
		async status() {
			return config();
		},
		async saveCredential({ appId, appSecret }) {
			const id = (appId || '').trim();
			const secret = (appSecret || '').trim();
			if (!/^wx[0-9a-f]{16}$/i.test(id)) throw new Error('AppID 格式不正确（应为 wx 开头的 18 位字符）。');
			if (!secret) throw new Error('AppSecret 不能为空。');
			await credentials.modifyRecord(CRED_KEY, () => ({
				kind: 'api-key',
				key: secret,
				env: { WECHAT_APP_ID: id },
			}));
			return { ok: true };
		},
		async clearCredential() {
			await credentials.deleteRecord(CRED_KEY);
			return { ok: true };
		},
		async verify() {
			return withClient(async client => {
				// 能成功取得 access_token 即证明 AppID/AppSecret 正确且出口 IP 在白名单内。
				const info = await client.checkConnection();
				return { ok: true, account: info };
			});
		},
		// 素材
		async materialList({ type = 'image', offset = 0, count = 20 } = {}) {
			return withClient(c => c.materialList(type, offset, count));
		},
		async materialCount() {
			return withClient(c => c.materialCount());
		},
		async materialDelete({ mediaId }) {
			if (!mediaId) throw new Error('缺少 mediaId。');
			return withClient(c => c.materialDelete(mediaId));
		},
		async materialUpload({ filename, bytesBase64, type = 'image' }) {
			if (!filename || !bytesBase64) throw new Error('缺少文件名或文件内容。');
			const bytes = Buffer.from(bytesBase64, 'base64');
			const ext = (filename.split('.').pop() || '').toLowerCase();
			const fields = type === 'video' ? {} : {};
			return withClient(c => c.uploadMedia(type, filename, bytes, fields));
		},
		// 上传正文内嵌图片，返回可直接放进正文 HTML 的 url（不占素材库配额）。
		async uploadContentImage({ filename, bytesBase64 }) {
			if (!filename || !bytesBase64) throw new Error('缺少文件名或文件内容。');
			const bytes = Buffer.from(bytesBase64, 'base64');
			return withClient(c => c.uploadContentImage(filename, bytes));
		},
		// 草稿
		async draftList({ offset = 0, count = 20 } = {}) {
			return withClient(c => c.draftList(offset, count));
		},
		async draftCount() {
			return withClient(c => c.draftCount());
		},
		async draftGet({ mediaId }) {
			if (!mediaId) throw new Error('缺少 mediaId。');
			return withClient(c => c.draftGet(mediaId));
		},
		// 归一化为微信 draft/add 的 article 结构，接受 camelCase 或微信原名。
		normalizeArticle(a) {
			const cover = a.coverMediaId || a.thumb_media_id || '';
			const toBool = v => (v === true || v === 1 || v === '1' ? 1 : 0);
			return {
				title: a.title || '',
				author: a.author || '',
				digest: a.digest || '',
				content: a.content || '',
				content_source_url: a.contentSourceUrl || a.content_source_url || '',
				thumb_media_id: cover,
				show_cover_pic: toBool(a.showCoverPic !== undefined ? a.showCoverPic : a.show_cover_pic !== undefined ? a.show_cover_pic : (cover ? 1 : 0)),
				need_open_comment: toBool(a.needOpenComment !== undefined ? a.needOpenComment : a.need_open_comment),
				only_fans_can_comment: toBool(a.onlyFansCanComment !== undefined ? a.onlyFansCanComment : a.only_fans_can_comment),
			};
		},
		async draftCreate({ articles, title, author = '', digest = '', content, coverMediaId = '', contentSourceUrl = '' }) {
			let list;
			if (Array.isArray(articles) && articles.length) {
				list = articles.map(a => this.normalizeArticle(a));
			} else if (title && content) {
				// 兼容旧的单篇参数调用（Agent 工具 / 旧 UI）。
				list = [this.normalizeArticle({ title, author, digest, content, coverMediaId, contentSourceUrl })];
			} else {
				throw new Error('缺少 articles，或缺少单篇的 title/content。');
			}
			if (!list.length) throw new Error('articles 不能为空。');
			if (list.length > 8) throw new Error('一篇草稿最多 8 篇文章。');
			if (list.some(a => !a.title || !a.content)) throw new Error('每篇文章的 title 与 content 都不能为空。');
			return withClient(c => c.draftAdd(list));
		},
		async draftUpdate({ mediaId, articles, index = 0, title, author = '', digest = '', content, coverMediaId = '' }) {
			if (!mediaId) throw new Error('缺少 mediaId。');
			let list;
			if (Array.isArray(articles) && articles.length) {
				list = articles.map(a => this.normalizeArticle(a));
			} else if (title && content) {
				list = [this.normalizeArticle({ title, author, digest, content, coverMediaId })];
			} else {
				throw new Error('缺少 articles，或缺少单篇的 title/content。');
			}
			if (list.length > 8) throw new Error('一篇草稿最多 8 篇文章。');
			if (list.some(a => !a.title || !a.content)) throw new Error('每篇文章的 title 与 content 都不能为空。');
			// 微信 draft/update 只能原位替换、不能增删或改变篇数。
			// 多图文整篇替换用「新建 + 删除旧草稿」保证增删/排序都能生效；
			// 单篇兼容调用仍走原位更新，保留 media_id。
			if (Array.isArray(articles) && articles.length) {
				return withClient(async c => {
					const created = await c.draftAdd(list);
					try { await c.draftDelete(mediaId); } catch { /* 旧草稿删除失败不影响新草稿 */ }
					return created;
				});
			}
			return withClient(c => c.draftUpdate(mediaId, index, list[0]));
		},
		async draftDelete({ mediaId }) {
			if (!mediaId) throw new Error('缺少 mediaId。');
			return withClient(c => c.draftDelete(mediaId));
		},
		// 发布
		async publish({ mediaId }) {
			if (!mediaId) throw new Error('缺少 mediaId。');
			return withClient(c => c.publishSubmit(mediaId));
		},
		async publishList({ offset = 0, count = 20 } = {}) {
			return withClient(c => c.publishList(offset, count));
		},
		async publishCount() {
			return withClient(c => c.publishCount());
		},
		async publishGet({ articleId }) {
			if (!articleId) throw new Error('缺少 articleId。');
			return withClient(c => c.publishGet(articleId));
		},
		async publishDelete({ articleId }) {
			if (!articleId) throw new Error('缺少 articleId。');
			return withClient(c => c.publishDelete(articleId));
		},
	};
}

export const name = 'wechat-official-account';
export const inject = ['credentials', 'tools'];

export function apply(ctx) {
	const service = createService(ctx);
	ctx.provide('wechat', service);

	// ---- Agent 工具：与面板共用同一服务对象 ----
	const articleProps = {
		title: { type: 'string', description: '文章标题（必填）。' },
		content: { type: 'string', description: '正文 HTML（必填）。' },
		author: { type: 'string', description: '作者。' },
		digest: { type: 'string', description: '摘要。' },
		coverMediaId: { type: 'string', description: '封面图片的永久素材 media_id（image 类型）。' },
		contentSourceUrl: { type: 'string', description: '原文链接。' },
		showCoverPic: { type: 'boolean', description: '是否显示封面，默认有封面则为 true。' },
		needOpenComment: { type: 'boolean', description: '是否开启评论，默认 false。' },
		onlyFansCanComment: { type: 'boolean', description: '是否仅粉丝可评论，默认 false。' },
	};
	const articlesProp = {
		type: 'array',
		description: '多图文文章列表（1-8 篇），每篇含 title/content 等字段。传了它则忽略单篇参数。',
		items: { type: 'object', properties: articleProps, required: ['title', 'content'] },
	};
	const tools = [
		{
			name: 'wechat_status',
			description: '查看微信公众号插件状态：是否已在凭据保险箱配置 AppID/AppSecret。',
			parameters: { type: 'object', properties: {} },
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: () => service.status(),
		},
		{
			name: 'wechat_verify',
			description: '校验微信公众号凭据是否有效（调用微信账号信息接口）。需要已配置 AppID/AppSecret，且出口 IP 在白名单中。',
			parameters: { type: 'object', properties: {} },
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: () => service.verify(),
		},
		{
			name: 'wechat_material_list',
			description: '列出微信公众号永久素材。type 支持 image/voice/video/thumb；offset/count 分页。',
			parameters: {
				type: 'object',
				properties: {
					type: { type: 'string', enum: ['image', 'voice', 'video', 'thumb'], description: '素材类型，默认 image。' },
					offset: { type: 'number', description: '偏移，默认 0。' },
					count: { type: 'number', description: '数量，默认 20，最大 20。' },
				},
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.materialList(a),
		},
		{
			name: 'wechat_material_upload',
			description: '上传永久素材到微信公众号（图片/语音/缩略图）。bytesBase64 为文件内容的 Base64，文件大小受微信接口限制（图片≤10MB，语音≤2MB，视频≤10MB）。',
			parameters: {
				type: 'object',
				properties: {
					type: { type: 'string', enum: ['image', 'voice', 'thumb', 'video'], description: '素材类型，默认 image。' },
					filename: { type: 'string', description: '文件名（含扩展名），例如 cover.jpg。' },
					bytesBase64: { type: 'string', description: '文件内容的 Base64 编码字符串。' },
				},
				required: ['filename', 'bytesBase64'],
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.materialUpload(a),
		},
		{
			name: 'wechat_material_delete',
			description: '删除微信公众号永久素材。需要 media_id。确认要删除后再调用，操作不可逆。',
			parameters: {
				type: 'object',
				properties: { mediaId: { type: 'string', description: '要删除素材的 media_id。' } },
				required: ['mediaId'],
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.materialDelete(a),
		},
		{
			name: 'wechat_draft_list',
			description: '列出公众号草稿箱中的草稿（不含正文），offset/count 分页。',
			parameters: {
				type: 'object',
				properties: {
					offset: { type: 'number', description: '偏移，默认 0。' },
					count: { type: 'number', description: '数量，默认 20。' },
				},
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.draftList(a),
		},
		{
			name: 'wechat_draft_get',
			description: '获取指定草稿的完整内容（含正文 HTML）。',
			parameters: {
				type: 'object',
				properties: { mediaId: { type: 'string', description: '草稿的 media_id。' } },
				required: ['mediaId'],
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.draftGet(a),
		},
		{
			name: 'wechat_draft_create',
			description: '新建公众号草稿。传 articles 多图文列表（1-8 篇），或传单篇的 title+content。封面用已上传图片的 media_id。',
			parameters: {
				type: 'object',
				properties: { articles: articlesProp, ...articleProps },
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.draftCreate(a),
		},
		{
			name: 'wechat_draft_update',
			description: '修改已有草稿。mediaId 必填；传 articles 整篇多图文替换，或传单篇的 title+content 替换指定 index（默认 0）。',
			parameters: {
				type: 'object',
				properties: {
					mediaId: { type: 'string', description: '草稿 media_id。' },
					index: { type: 'number', description: '单篇替换时的文章序号，默认 0。' },
					articles: articlesProp,
					...articleProps,
				},
				required: ['mediaId'],
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.draftUpdate(a),
		},
		{
			name: 'wechat_upload_content_image',
			description: '上传正文内嵌图片，返回可放进正文 HTML 的图片 URL（不占素材库配额）。bytesBase64 为图片文件的 base64。',
			parameters: {
				type: 'object',
				properties: {
					filename: { type: 'string', description: '图片文件名（含扩展名）。' },
					bytesBase64: { type: 'string', description: '图片内容的 base64 编码。' },
				},
				required: ['filename', 'bytesBase64'],
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.uploadContentImage(a),
		},
		{
			name: 'wechat_draft_delete',
			description: '删除草稿。需要 media_id，确认要删除后再调用，操作不可逆。',
			parameters: {
				type: 'object',
				properties: { mediaId: { type: 'string', description: '草稿 media_id。' } },
				required: ['mediaId'],
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.draftDelete(a),
		},
		{
			name: 'wechat_publish',
			description: '发布草稿到公众号。需要草稿的 media_id；发布后文章对外可见，请确认内容无误。',
			parameters: {
				type: 'object',
				properties: { mediaId: { type: 'string', description: '要发布的草稿 media_id。' } },
				required: ['mediaId'],
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.publish(a),
		},
		{
			name: 'wechat_publish_list',
			description: '列出已发布文章，offset/count 分页。',
			parameters: {
				type: 'object',
				properties: {
					offset: { type: 'number', description: '偏移，默认 0。' },
					count: { type: 'number', description: '数量，默认 20。' },
				},
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.publishList(a),
		},
		{
			name: 'wechat_publish_delete',
			description: '删除已发布文章。需要 article_id，确认要删除后再调用，操作不可逆。',
			parameters: {
				type: 'object',
				properties: { articleId: { type: 'string', description: '已发布文章的 article_id。' } },
				required: ['articleId'],
			},
			output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
			execute: a => service.publishDelete(a),
		},
	];
	const disposers = tools.map(def => ctx.tools.register(def));

	// ---- Client 面板 HTTP 路由（webServer 为可选依赖） ----
	const routeTable = {
		'/api/wechat/status': () => service.status(),
		'/api/wechat/verify': () => service.verify(),
		'/api/wechat/material/list': a => service.materialList(a),
		'/api/wechat/material/count': () => service.materialCount(),
		'/api/wechat/material/delete': a => service.materialDelete(a),
		'/api/wechat/material/upload': a => service.materialUpload(a),
		'/api/wechat/upload-content-image': a => service.uploadContentImage(a),
		'/api/wechat/draft/list': a => service.draftList(a),
		'/api/wechat/draft/count': () => service.draftCount(),
		'/api/wechat/draft/get': a => service.draftGet(a),
		'/api/wechat/draft/create': a => service.draftCreate(a),
		'/api/wechat/draft/update': a => service.draftUpdate(a),
		'/api/wechat/draft/delete': a => service.draftDelete(a),
		'/api/wechat/publish': a => service.publish(a),
		'/api/wechat/publish/list': a => service.publishList(a),
		'/api/wechat/publish/count': () => service.publishCount(),
		'/api/wechat/publish/delete': a => service.publishDelete(a),
		'/api/wechat/credential': a => a._method === 'DELETE' ? service.clearCredential() : service.saveCredential(a),
	};

	ctx.inject(['webServer'], c => {
		const webServer = c.get('webServer');
		if (!webServer || typeof webServer.register !== 'function') return;
		function send(res, status, data) {
			res.statusCode = status;
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
			res.setHeader('Cache-Control', 'no-store');
			res.end(JSON.stringify(data));
		}
		async function readBody(req) {
			const chunks = [];
			let size = 0;
			for await (const chunk of req) {
				size += chunk.length;
				if (size > 2 * 1024 * 1024) throw new Error('请求体超过 2MB 限制');
				chunks.push(chunk);
			}
			if (!chunks.length) return {};
			return JSON.parse(Buffer.concat(chunks).toString('utf8'));
		}
		function guardWrite(req, res) {
			const origin = req.headers.origin;
			const host = req.headers.host;
			if (origin && host) {
				let same = false;
				try {
					const u = new URL(origin);
					same = u.host === host;
				} catch { /* ignore */ }
				if (!same) {
					send(res, 403, { error: '拒绝跨站请求' });
					return false;
				}
			}
			const ct = (req.headers['content-type'] || '').split(';')[0].trim();
			if (ct !== 'application/json') {
				send(res, 415, { error: '需要 application/json 请求体' });
				return false;
			}
			return true;
		}
		const routeDisposers = [];
		for (const [path, handler] of Object.entries(routeTable)) {
			routeDisposers.push(ctx.effect(() => {
				webServer.exact.delete(path);
				webServer.prefixes.delete(path);
				return webServer.register({
					kind: 'exact',
					path,
					async handler(req, res) {
						try {
							const isWrite = !['/api/wechat/status', '/api/wechat/material/list', '/api/wechat/material/count', '/api/wechat/draft/list', '/api/wechat/draft/count', '/api/wechat/draft/get', '/api/wechat/publish/list', '/api/wechat/publish/count', '/api/wechat/verify'].includes(path) && req.method !== 'GET';
							if (isWrite && !guardWrite(req, res)) return;
							const body = req.method === 'GET' ? {} : await readBody(req);
							body._method = req.method;
							const data = await handler(body);
							send(res, 200, data ?? { ok: true });
						} catch (err) {
							const status = err instanceof WeChatApiError ? 502 : 400;
							send(res, status, { error: err?.message || String(err), errcode: err?.errcode });
						}
					},
				}, `wechat route ${path}`);
			}, `wechat route ${path}`));
		}
		return () => routeDisposers.forEach(d => d?.());
	});

	ctx.effect(() => () => disposers.forEach(d => d?.()), 'wechat tools');
}
