/**
 * 微信公众平台 API 客户端（仅 Host 侧使用）。
 * 负责 access_token 缓存与各类素材/草稿/发布接口的调用。
 */

const API_BASE = 'https://api.weixin.qq.com';

export class WeChatApiError extends Error {
	constructor(message, errcode, payload) {
		super(message);
		this.name = 'WeChatApiError';
		this.errcode = errcode;
		this.payload = payload;
	}
}

function normalizeError(json) {
	if (!json || typeof json !== 'object') return new WeChatApiError('微信接口返回了无法解析的响应', undefined, json);
	const code = json.errcode;
	if (code === undefined || code === 0) return null;
	const messages = {
		40001: 'AppSecret 错误或 access_token 失效',
		40013: 'AppID 无效',
		40164: '调用方 IP 不在白名单中，请把当前出口 IP 加入公众号 IP 白名单',
		40007: 'media_id 无效：封面必须是永久图片素材的 media_id，请先在「素材」页上传图片并选用其 media_id',
		48001: '接口未授权，公众号类型/权限不足（多数接口需认证服务号）',
		45009: '接口调用频率超限',
	};
	const hint = messages[code] ? `（${messages[code]}）` : '';
	return new WeChatApiError(`微信接口错误 ${code}: ${json.errmsg || '未知错误'}${hint}`, code, json);
}

export class WeChatClient {
	constructor(appId, appSecret, fetchImpl = globalThis.fetch) {
		this.appId = appId;
		this.appSecret = appSecret;
		this.fetch = fetchImpl;
		this.tokenCache = { token: null, expiresAt: 0 };
	}

	async getAccessToken(force = false) {
		if (!force && this.tokenCache.token && Date.now() < this.tokenCache.expiresAt) return this.tokenCache.token;
		const url = `${API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`;
		const res = await this.fetch(url);
		const json = await res.json();
		const err = normalizeError(json);
		if (err) throw err;
		if (!json.access_token) throw new WeChatApiError('获取 access_token 失败：响应中没有 access_token', undefined, json);
		this.tokenCache = {
			token: json.access_token,
			expiresAt: Date.now() + Math.max(60, (json.expires_in || 7200) - 300) * 1000,
		};
		return this.tokenCache.token;
	}

	async request(path, { method = 'GET', query = {}, body } = {}) {
		const token = await this.getAccessToken();
		const url = new URL(API_BASE + path);
		url.searchParams.set('access_token', token);
		for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
		const init = { method, headers: { Accept: 'application/json' } };
		if (body !== undefined) {
			init.headers['Content-Type'] = 'application/json; charset=utf-8';
			init.body = JSON.stringify(body);
		}
		const res = await this.fetch(url.toString(), init);
		let json;
		try {
			json = await res.json();
		} catch {
			throw new WeChatApiError(`微信接口返回非 JSON 内容（HTTP ${res.status}）`, res.status);
		}
		const err = normalizeError(json);
		if (err) throw err;
		return json;
	}

	/**  multipart/form-data 上传永久素材。fileBytes 为 Buffer/Uint8Array，filename 含扩展名。 */
	async uploadMedia(type, filename, fileBytes, extraFields = {}) {
		const token = await this.getAccessToken();
		const url = `${API_BASE}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`;
		const boundary = '----DSHWeChatBoundary' + Math.random().toString(16).slice(2);
		const encoder = new TextEncoder();
		const parts = [];
		for (const [k, v] of Object.entries(extraFields)) {
			parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
		}
		parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename.replace(/"/g, '')}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
		parts.push(typeof fileBytes === 'string' ? encoder.encode(fileBytes) : fileBytes);
		parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
		const body = Buffer.concat(parts.map(p => Buffer.from(p)));
		const res = await this.fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
			body,
		});
		const json = await res.json();
		const err = normalizeError(json);
		if (err) throw err;
		return json;
	}

	/**
	 * 上传正文内嵌图片，返回可在正文 HTML 中直接使用的 URL。
	 * 使用 /media/uploadimg，不占用永久素材库配额。
	 */
	async uploadContentImage(filename, fileBytes) {
		const token = await this.getAccessToken();
		const url = `${API_BASE}/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`;
		const boundary = '----DSHWeChatBoundary' + Math.random().toString(16).slice(2);
		const encoder = new TextEncoder();
		const body = Buffer.concat([
			Buffer.from(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename.replace(/"/g, '')}"\r\nContent-Type: application/octet-stream\r\n\r\n`)),
			Buffer.from(fileBytes),
			Buffer.from(encoder.encode(`\r\n--${boundary}--\r\n`)),
		]);
		const res = await this.fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
			body,
		});
		const json = await res.json();
		const err = normalizeError(json);
		if (err) throw err;
		return json; // { url }
	}

	// ---- 素材 ----
	materialList(type = 'image', offset = 0, count = 20) {
		return this.request('/cgi-bin/material/batchget_material', {
			method: 'POST',
			body: { type, offset, count },
		});
	}
	materialGet(mediaId) {
		return this.request('/cgi-bin/material/get_material', { method: 'POST', body: { media_id: mediaId } });
	}
	materialDelete(mediaId) {
		return this.request('/cgi-bin/material/del_material', { method: 'POST', body: { media_id: mediaId } });
	}
	materialCount() {
		return this.request('/cgi-bin/material/get_materialcount');
	}

	// ---- 草稿箱 ----
	draftList(offset = 0, count = 20) {
		return this.request('/cgi-bin/draft/batchget', { method: 'POST', body: { offset, count, no_content: 1 } });
	}
	draftGet(mediaId) {
		return this.request('/cgi-bin/draft/get', { method: 'POST', body: { media_id: mediaId } });
	}
	draftAdd(articles) {
		return this.request('/cgi-bin/draft/add', { method: 'POST', body: { articles } });
	}
	// 微信 draft/update 每次只替换指定 index 的一篇，articles 必须是数组。
	draftUpdate(mediaId, index, article) {
		const articles = Array.isArray(article) ? article : [article];
		return this.request('/cgi-bin/draft/update', { method: 'POST', body: { media_id: mediaId, index, articles } });
	}
	// 更新整篇多图文草稿：逐篇替换，返回最后一次的结果。
	async draftUpdateArticles(mediaId, articles) {
		let last = null;
		for (let i = 0; i < articles.length; i++) {
			last = await this.draftUpdate(mediaId, i, articles[i]);
		}
		return last || {};
	}
	draftDelete(mediaId) {
		return this.request('/cgi-bin/draft/delete', { method: 'POST', body: { media_id: mediaId } });
	}
	draftCount() {
		return this.request('/cgi-bin/draft/count');
	}

	// ---- 发布 ----
	publishSubmit(mediaId) {
		return this.request('/cgi-bin/freepublish/submit', { method: 'POST', body: { media_id: mediaId } });
	}
	publishList(offset = 0, count = 20) {
		return this.request('/cgi-bin/freepublish/batchget', { method: 'POST', body: { offset, count, no_content: 1 } });
	}
	publishGet(articleId) {
		return this.request('/cgi-bin/freepublish/get', { method: 'POST', body: { article_id: articleId } });
	}
	publishDelete(articleId) {
		return this.request('/cgi-bin/freepublish/delete', { method: 'POST', body: { article_id: articleId } });
	}
	// 微信公众平台没有 /cgi-bin/freepublish/count 接口（会返回 40066 invalid url）。
	// 已发布总数由 /cgi-bin/freepublish/batchget 的 total_count 提供。
	async publishCount() {
		const data = await this.publishList(0, 1);
		return { total_count: data.total_count || 0 };
	}

	// ---- 账号/连接 ----
	// 微信公众平台没有公开的 /cgi-bin/account/getaccountinfo 接口（会返回 40066 invalid url）。
	// 连接测试只需确认 AppID/AppSecret 正确且出口 IP 在白名单中：能拿到 access_token 即通过。
	async checkConnection() {
		await this.getAccessToken();
		return { appid: this.appId };
	}
}
