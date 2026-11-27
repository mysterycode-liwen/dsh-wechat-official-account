/**
 * 微信公众号管理插件 — Client 半边（侧边栏入口 + 主面板）。
 *
 * 所有写操作都经本地 HTTP 路由 /api/wechat/* 调用 Host 侧同一服务对象，
 * 不在浏览器直接访问微信接口，也不接触 AppSecret。
 */

window.__ModuleLoader__.load({
	id: '@local/wechat-official-account',
	factory(require) {
		const React = require('react');
		const { useState, useEffect, useCallback, useRef } = React;
		const h = React.createElement;

		const PANEL_ID = 'wechat';
		const API = '/api/wechat';

		async function api(path, options = {}) {
			const { method = 'GET', body } = options;
			const init = { method, headers: {} };
			if (body !== undefined) {
				init.headers['Content-Type'] = 'application/json';
				init.body = JSON.stringify(body);
			}
			const res = await fetch(API + path, init);
			let data;
			try { data = await res.json(); } catch { data = {}; }
			if (!res.ok || data.error) {
				const err = new Error(data.error || `请求失败（HTTP ${res.status}）`);
				err.errcode = data.errcode;
				throw err;
			}
			return data;
		}

		// ---- 图标组件：宿主给 size，选中态由宿主负责 ----
		function WechatSidebarIcon({ size = 20 }) {
			return h('svg', { width: size, height: size, viewBox: '0 0 36 36', 'aria-hidden': true },
				h('path', { fill: 'currentColor', d: 'M18 7C10.9 7 5 11.9 5 18c0 2 .6 3.9 1.7 5.5L5 29l5.9-1.8C13 28.7 15.4 29.5 18 29.5c7.1 0 13-4.9 13-11S25.1 7 18 7z' }),
				h('circle', { fill: 'var(--dsw-alias-bg, #fff)', cx: 13, cy: 17, r: 1.9 }),
				h('circle', { fill: 'var(--dsw-alias-bg, #fff)', cx: 23, cy: 17, r: 1.9 }),
			);
		}

		// ---- 通用小组件 ----
		function Button({ children, onClick, variant = 'default', disabled, type = 'button' }) {
			return h('button', {
				type, onClick, disabled,
				className: `wx-btn wx-btn-${variant}`,
			}, children);
		}

		function Empty({ children }) {
			return h('div', { className: 'wx-empty' }, children);
		}

		function ErrorBar({ message }) {
			return message ? h('div', { className: 'wx-error' }, message) : null;
		}

		function Modal({ title, onClose, children, wide }) {
			return h('div', { className: 'wx-modal-backdrop', onClick: onClose },
				h('div', { className: 'wx-modal' + (wide ? ' wx-modal-wide' : ''), onClick: e => e.stopPropagation() },
					h('div', { className: 'wx-modal-head' },
						h('strong', null, title),
						h('button', { className: 'wx-icon-btn', onClick: onClose, 'aria-label': '关闭' }, '✕'),
					),
					h('div', { className: 'wx-modal-body' }, children),
				),
			);
		}

		function Field({ label, children, hint }) {
			return h('label', { className: 'wx-field' },
				h('span', { className: 'wx-field-label' }, label),
				children,
				hint ? h('span', { className: 'wx-field-hint' }, hint) : null,
			);
		}

		// ---- 各标签页 ----
		function Materials() {
			const [list, setList] = useState([]);
			const [total, setTotal] = useState(0);
			const [offset, setOffset] = useState(0);
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState('');
			const [uploadOpen, setUploadOpen] = useState(false);
			const [uploadType, setUploadType] = useState('image');
			const [uploadFile, setUploadFile] = useState(null);
			const [type, setType] = useState('image');
			const fileRef = useRef(null);

			const load = useCallback(async (o = offset) => {
				setBusy(true); setError('');
				try {
					const [data, count] = await Promise.all([
						api(`/material/list?type=${type}&offset=${o}&count=20`),
						api('/material/count'),
					]);
					setList(data.item || []);
					setTotal(count[type + '_count'] || 0);
					setOffset(o);
				} catch (e) { setError(e.message); }
				finally { setBusy(false); }
			}, [offset, type]);

			useEffect(() => { load(0); }, [type]);

			async function doDelete(id) {
				if (!window.confirm('确定删除该素材？此操作不可逆。')) return;
				try { await api('/material/delete', { method: 'POST', body: { mediaId: id } }); await load(offset); }
				catch (e) { setError(e.message); }
			}

			async function doUpload() {
				if (!uploadFile) { setError('请先选择文件'); return; }
				setBusy(true); setError('');
				try {
					const base64 = await new Promise((resolve, reject) => {
						const reader = new FileReader();
						reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
						reader.onerror = reject;
						reader.readAsDataURL(uploadFile);
					});
					await api('/material/upload', { method: 'POST', body: { type: uploadType, filename: uploadFile.name, bytesBase64: base64 } });
					setUploadOpen(false); setUploadFile(null);
					await load(0);
				} catch (e) { setError(e.message); }
				finally { setBusy(false); }
			}

			return h('div', { className: 'wx-section' },
				h('div', { className: 'wx-toolbar' },
					h('select', { value: type, onChange: e => setType(e.target.value) },
						h('option', { value: 'image' }, '图片'),
						h('option', { value: 'voice' }, '语音'),
						h('option', { value: 'video' }, '视频'),
						h('option', { value: 'thumb' }, '缩略图'),
					),
					h('span', { className: 'wx-muted' }, `共 ${total} 个`),
					h('div', { className: 'wx-spacer' }),
					h(Button, { variant: 'primary', onClick: () => setUploadOpen(true) }, '上传素材'),
				),
				h(ErrorBar, { message: error }),
				busy ? h('div', { className: 'wx-muted' }, '加载中…') : null,
				list.length === 0 && !busy ? h(Empty, null, '暂无素材') : null,
				h('div', { className: 'wx-grid' }, list.map(item =>
					h('div', { className: 'wx-card', key: item.media_id },
						type === 'image' && item.url ? h('img', { src: item.url, alt: item.name || '', className: 'wx-thumb' }) : null,
						h('div', { className: 'wx-card-title', title: item.name }, item.name || '(无名称)'),
						h('div', { className: 'wx-muted wx-small' }, item.update_time ? new Date(item.update_time * 1000).toLocaleString() : ''),
						h('div', { className: 'wx-card-actions' },
							h(Button, { variant: 'danger', onClick: () => doDelete(item.media_id) }, '删除'),
						),
					),
				)),
				h('div', { className: 'wx-pager' },
					h(Button, { disabled: offset === 0 || busy, onClick: () => load(Math.max(0, offset - 20)) }, '上一页'),
					h('span', { className: 'wx-muted' }, `第 ${Math.floor(offset / 20) + 1} 页`),
					h(Button, { disabled: offset + 20 >= total || busy, onClick: () => load(offset + 20) }, '下一页'),
				),
				uploadOpen ? h(Modal, { title: '上传素材', onClose: () => setUploadOpen(false) },
					h(Field, { label: '素材类型' },
						h('select', { value: uploadType, onChange: e => setUploadType(e.target.value) },
							h('option', { value: 'image' }, '图片'),
							h('option', { value: 'voice' }, '语音'),
							h('option', { value: 'thumb' }, '缩略图'),
							h('option', { value: 'video' }, '视频'),
						),
					),
					h(Field, { label: '选择文件' },
						h('input', {
							ref: fileRef, type: 'file',
							accept: uploadType === 'image' ? 'image/*' : undefined,
							onChange: e => setUploadFile(e.target.files[0] || null),
						}),
					),
					h('div', { className: 'wx-modal-foot' },
						h(Button, { onClick: () => setUploadOpen(false) }, '取消'),
						h(Button, { variant: 'primary', onClick: doUpload, disabled: busy || !uploadFile }, '上传'),
					),
				) : null,
			);
		}

		function readFileBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});
		}

		// 所见即所得正文编辑器（contentEditable + execCommand，无外部依赖）。
		// 父组件用 key={index} 强制切换文章时重新挂载，避免光标跳动。
		function RichEditor({ value, onChange }) {
			const ref = useRef(null);
			const imgRef = useRef(null);
			const savedRange = useRef(null);

			useEffect(() => {
				if (ref.current) ref.current.innerHTML = value || '';
			}, []);

			function sync() {
				if (ref.current) onChange(ref.current.innerHTML);
			}
			function exec(cmd, arg) {
				ref.current?.focus();
				document.execCommand(cmd, false, arg);
				sync();
			}
			function saveSelection() {
				const sel = window.getSelection();
				if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) {
					savedRange.current = sel.getRangeAt(0).cloneRange();
				}
			}
			function restoreSelection() {
				const sel = window.getSelection();
				if (savedRange.current && sel) {
					sel.removeAllRanges();
					sel.addRange(savedRange.current);
				}
			}
			async function insertImage(file) {
				if (!file) return;
				restoreSelection();
				try {
					const base64 = await readFileBase64(file);
					const r = await api('/upload-content-image', { method: 'POST', body: { filename: file.name, bytesBase64: base64 } });
					const url = r.url || r.data?.url;
					if (!url) throw new Error('上传图片未返回 URL');
					restoreSelection();
					exec('insertHTML', `<img src="${url}" alt="${(file.name || '').replace(/"/g, '')}" style="max-width:100%"/>`);
				} catch (e) {
					window.alert('图片上传失败：' + e.message);
				}
				if (imgRef.current) imgRef.current.value = '';
			}

			const tools = [
				{ label: 'B', title: '加粗', cmd: 'bold', style: 'font-weight:700' },
				{ label: 'I', title: '斜体', cmd: 'italic', style: 'font-style:italic' },
				{ label: 'U', title: '下划线', cmd: 'underline', style: 'text-decoration:underline' },
				{ label: 'H2', title: '标题', cmd: 'formatBlock', arg: 'h2' },
				{ label: 'H3', title: '小标题', cmd: 'formatBlock', arg: 'h3' },
				{ label: 'P', title: '正文', cmd: 'formatBlock', arg: 'p' },
				{ label: '≡', title: '无序列表', cmd: 'insertUnorderedList' },
				{ label: '1.', title: '有序列表', cmd: 'insertOrderedList' },
				{ label: '❝', title: '引用', cmd: 'formatBlock', arg: 'blockquote' },
				{ label: '—', title: '分割线', cmd: 'insertHTML', arg: '<hr/>' },
			];

			return h('div', { className: 'wx-rich' },
				h('div', { className: 'wx-rich-toolbar' },
					tools.map(t => h('button', {
						type: 'button', key: t.title, title: t.title, className: 'wx-rich-tool',
						style: t.style || undefined,
						onMouseDown: e => { e.preventDefault(); exec(t.cmd, t.arg); },
					}, t.label)),
					h('button', {
						type: 'button', title: '链接', className: 'wx-rich-tool',
						onMouseDown: e => {
							e.preventDefault();
							const url = window.prompt('请输入链接地址（http/https）');
							if (url) exec('createLink', url);
						},
					}, '🔗'),
					h('button', {
						type: 'button', title: '插入图片', className: 'wx-rich-tool',
						onMouseDown: e => { e.preventDefault(); saveSelection(); imgRef.current?.click(); },
					}, '🖼'),
					h('button', {
						type: 'button', title: '撤销', className: 'wx-rich-tool',
						onMouseDown: e => { e.preventDefault(); exec('undo'); },
					}, '↶'),
					h('button', {
						type: 'button', title: '重做', className: 'wx-rich-tool',
						onMouseDown: e => { e.preventDefault(); exec('redo'); },
					}, '↷'),
					h('button', {
						type: 'button', title: '清除格式', className: 'wx-rich-tool',
						onMouseDown: e => { e.preventDefault(); exec('removeFormat'); },
					}, '⌫'),
					h('input', {
						ref: imgRef, type: 'file', accept: 'image/*', style: { display: 'none' },
						onChange: e => insertImage(e.target.files[0] || null),
					}),
				),
				h('div', {
					ref: ref, className: 'wx-rich-area', contentEditable: true, suppressContentEditableWarning: true,
					onInput: sync, onBlur: sync,
				}),
			);
		}

		function Drafts({ onPublished }) {
			const [list, setList] = useState([]);
			const [total, setTotal] = useState(0);
			const [offset, setOffset] = useState(0);
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState('');
			const [editor, setEditor] = useState(null); // { mediaId?, articles:[...] }
			const [active, setActive] = useState(0); // 当前编辑的文章序号
			const [preview, setPreview] = useState(false);
			const [busyEdit, setBusyEdit] = useState(false);
			const [covers, setCovers] = useState([]);

			const loadCovers = useCallback(async () => {
				try {
					const data = await api('/material/list?type=image&offset=0&count=100');
					setCovers(data.item || []);
				} catch (e) { /* 素材加载失败不影响草稿编辑，下拉框留空 */ }
			}, []);

			const load = useCallback(async (o = offset) => {
				setBusy(true); setError('');
				try {
					const [data, count] = await Promise.all([api(`/draft/list?offset=${o}&count=20`), api('/draft/count')]);
					setList(data.item || []);
					setTotal(count.total_count || 0);
					setOffset(o);
				} catch (e) { setError(e.message); }
				finally { setBusy(false); }
			}, [offset]);

			useEffect(() => { load(0); }, []);

			function blankArticle() {
				return {
					title: '', author: '', digest: '', content: '', coverMediaId: '',
					contentSourceUrl: '', showCoverPic: true, needOpenComment: false, onlyFansCanComment: false,
				};
			}
			function fromWeChat(a) {
				return {
					title: a.title || '', author: a.author || '', digest: a.digest || '',
					content: a.content || '', coverMediaId: a.thumb_media_id || '',
					contentSourceUrl: a.content_source_url || '',
					showCoverPic: a.show_cover_pic !== 0,
					needOpenComment: !!a.need_open_comment,
					onlyFansCanComment: !!a.only_fans_can_comment,
				};
			}

			async function openEdit(item) {
				try {
					setError(''); setPreview(false); setActive(0);
					loadCovers();
					const full = await api('/draft/get', { method: 'POST', body: { mediaId: item.media_id } });
					const items = full.news_item || [];
					setEditor({
						mediaId: item.media_id,
						articles: items.length ? items.map(fromWeChat) : [blankArticle()],
					});
				} catch (e) { setError(e.message); }
			}

			function openCreate() {
				loadCovers(); setPreview(false); setActive(0);
				setEditor({ mediaId: '', articles: [blankArticle()] });
			}

			function updateArticle(idx, fields) {
				setEditor(e => ({ ...e, articles: e.articles.map((a, i) => i === idx ? { ...a, ...fields } : a) }));
			}
			function addArticle() {
				if (editor.articles.length >= 8) { setError('一篇草稿最多 8 篇文章'); return; }
				setEditor(e => ({ ...e, articles: [...e.articles, blankArticle()] }));
				setActive(editor.articles.length);
				setPreview(false);
			}
			function removeArticle(idx) {
				if (editor.articles.length <= 1) { setError('草稿至少需要一篇文章'); return; }
				if (!window.confirm('确定删除这篇文章？')) return;
				setEditor(e => ({ ...e, articles: e.articles.filter((_, i) => i !== idx) }));
				setActive(Math.min(active, editor.articles.length - 2));
				setPreview(false);
			}
			function moveArticle(idx, dir) {
				const j = idx + dir;
				if (j < 0 || j >= editor.articles.length) return;
				const arr = [...editor.articles];
				[arr[idx], arr[j]] = [arr[j], arr[idx]];
				setEditor(e => ({ ...e, articles: arr }));
				setActive(j);
			}

			async function save() {
				if (editor.articles.some(a => !a.title || !a.content)) { setError('每篇文章的标题和正文都不能为空'); return; }
				if (editor.articles.some(a => !a.coverMediaId)) { setError('每篇文章都必须选择封面图片：请先在「素材」页上传图片，再在这里选用。'); return; }
				setBusyEdit(true); setError('');
				try {
					const articles = editor.articles.map(a => ({
						title: a.title, author: a.author, digest: a.digest, content: a.content,
						coverMediaId: a.coverMediaId, contentSourceUrl: a.contentSourceUrl,
						showCoverPic: a.showCoverPic, needOpenComment: a.needOpenComment, onlyFansCanComment: a.onlyFansCanComment,
					}));
					if (editor.mediaId) await api('/draft/update', { method: 'POST', body: { mediaId: editor.mediaId, articles } });
					else await api('/draft/create', { method: 'POST', body: { articles } });
					setEditor(null);
					await load(offset);
				} catch (e) { setError(e.message); }
				finally { setBusyEdit(false); }
			}

			async function doDelete(id) {
				if (!window.confirm('确定删除该草稿？此操作不可逆。')) return;
				try { await api('/draft/delete', { method: 'POST', body: { mediaId: id } }); await load(offset); }
				catch (e) { setError(e.message); }
			}

			async function doPublish(id) {
				if (!window.confirm('确定发布该草稿？发布后文章对外可见。')) return;
				try {
					await api('/publish', { method: 'POST', body: { mediaId: id } });
					await load(offset);
					onPublished?.();
				} catch (e) { setError(e.message); }
			}

			return h('div', { className: 'wx-section' },
				h('div', { className: 'wx-toolbar' },
					h('span', { className: 'wx-muted' }, `共 ${total} 篇草稿`),
					h('div', { className: 'wx-spacer' }),
					h(Button, { variant: 'primary', onClick: openCreate }, '新建草稿'),
				),
				h(ErrorBar, { message: error }),
				busy ? h('div', { className: 'wx-muted' }, '加载中…') : null,
				list.length === 0 && !busy ? h(Empty, null, '草稿箱为空') : null,
				h('div', { className: 'wx-list' }, list.map(item =>
					h('div', { className: 'wx-list-item', key: item.media_id },
						h('div', { className: 'wx-item-main' },
							h('div', { className: 'wx-item-title' }, (item.content?.news_item || [])[0]?.title || '(无标题)'),
							h('div', { className: 'wx-muted wx-small' }, (item.content?.news_item || [])[0]?.digest || ''),
						),
						h('div', { className: 'wx-item-actions' },
							h(Button, { onClick: () => openEdit(item) }, '编辑'),
							h(Button, { variant: 'primary', onClick: () => doPublish(item.media_id) }, '发布'),
							h(Button, { variant: 'danger', onClick: () => doDelete(item.media_id) }, '删除'),
						),
					),
				)),
				h('div', { className: 'wx-pager' },
					h(Button, { disabled: offset === 0 || busy, onClick: () => load(Math.max(0, offset - 20)) }, '上一页'),
					h('span', { className: 'wx-muted' }, `第 ${Math.floor(offset / 20) + 1} 页`),
					h(Button, { disabled: offset + 20 >= total || busy, onClick: () => load(offset + 20) }, '下一页'),
				),
				editor ? h(Modal, { title: editor.mediaId ? '编辑多图文草稿' : '新建多图文草稿', wide: true, onClose: () => setEditor(null) },
					h('div', { className: 'wx-article-tabs' },
						editor.articles.map((a, i) =>
							h('button', {
								type: 'button', key: i,
								className: 'wx-article-tab' + (active === i ? ' active' : ''),
								onClick: () => { setActive(i); setPreview(false); },
							}, `第 ${i + 1} 篇${a.title ? ' · ' + a.title.slice(0, 10) : ''}`),
						),
						h('button', { type: 'button', className: 'wx-article-add', onClick: addArticle, title: '添加一篇文章（最多 8 篇）' }, '+ 添加'),
					),
					(() => {
						const a = editor.articles[active];
						if (!a) return null;
						return h('div', { className: 'wx-article-editor' },
							h('div', { className: 'wx-article-bar' },
								h(Button, { onClick: () => removeArticle(active), variant: 'danger', disabled: editor.articles.length <= 1 }, '删除此篇'),
								h(Button, { onClick: () => moveArticle(active, -1), disabled: active === 0 }, '↑ 上移'),
								h(Button, { onClick: () => moveArticle(active, 1), disabled: active === editor.articles.length - 1 }, '↓ 下移'),
							),
							h(Field, { label: '标题' }, h('input', { type: 'text', value: a.title, onChange: e => updateArticle(active, { title: e.target.value }) })),
							h(Field, { label: '作者' }, h('input', { type: 'text', value: a.author, onChange: e => updateArticle(active, { author: e.target.value }) })),
							h(Field, { label: '摘要' }, h('textarea', { rows: 2, value: a.digest, onChange: e => updateArticle(active, { digest: e.target.value }) })),
							h(Field, { label: '封面图片', hint: '必须是永久图片素材的 media_id（否则微信返回 40007）' },
								h('select', { value: a.coverMediaId, onChange: e => updateArticle(active, { coverMediaId: e.target.value }) },
									h('option', { value: '' }, '请选择封面…'),
									covers.map(m => h('option', { key: m.media_id, value: m.media_id }, m.name || m.media_id)),
								),
								a.coverMediaId && covers.find(m => m.media_id === a.coverMediaId)?.url
									? h('img', { src: covers.find(m => m.media_id === a.coverMediaId).url, alt: '封面预览', className: 'wx-cover-preview' })
									: null,
							),
							h(Field, { label: '原文链接', hint: '可选，填文章原文 URL' },
								h('input', { type: 'text', value: a.contentSourceUrl, onChange: e => updateArticle(active, { contentSourceUrl: e.target.value }), placeholder: 'https://...' }),
							),
							h('div', { className: 'wx-check-row' },
								h('label', null,
									h('input', { type: 'checkbox', checked: !!a.showCoverPic, onChange: e => updateArticle(active, { showCoverPic: e.target.checked }) }),
									' 显示封面',
								),
								h('label', null,
									h('input', { type: 'checkbox', checked: !!a.needOpenComment, onChange: e => updateArticle(active, { needOpenComment: e.target.checked }) }),
									' 开启评论',
								),
								h('label', null,
									h('input', { type: 'checkbox', checked: !!a.onlyFansCanComment, onChange: e => updateArticle(active, { onlyFansCanComment: e.target.checked }) }),
									' 仅粉丝评论',
								),
							),
							h('div', { className: 'wx-field' },
								h('div', { className: 'wx-body-head' },
									h('span', { className: 'wx-field-label' }, '正文'),
									h('div', { className: 'wx-seg' },
										h('button', { type: 'button', className: 'wx-seg-btn' + (preview ? '' : ' active'), onClick: () => setPreview(false) }, '编辑'),
										h('button', { type: 'button', className: 'wx-seg-btn' + (preview ? ' active' : ''), onClick: () => setPreview(true) }, '预览'),
									),
								),
								preview
									? h('div', { className: 'wx-preview', dangerouslySetInnerHTML: { __html: a.content || '<p style="opacity:.5">（暂无正文）</p>' } })
									: h(RichEditor, { key: active, value: a.content, onChange: html => updateArticle(active, { content: html }) }),
							),
						);
					})(),
					h('div', { className: 'wx-modal-foot' },
						h(Button, { onClick: () => setEditor(null) }, '取消'),
						h(Button, { variant: 'primary', onClick: save, disabled: busyEdit }, busyEdit ? '保存中…' : `保存草稿（${editor.articles.length} 篇）`),
					),
				) : null,
			);
		}

		function Published() {
			const [list, setList] = useState([]);
			const [total, setTotal] = useState(0);
			const [offset, setOffset] = useState(0);
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState('');
			const [reloadKey, setReloadKey] = useState(0);

			const load = useCallback(async (o = offset) => {
				setBusy(true); setError('');
				try {
					const [data, count] = await Promise.all([api(`/publish/list?offset=${o}&count=20`), api('/publish/count')]);
					setList(data.item || []);
					setTotal(count.total_count || 0);
					setOffset(o);
				} catch (e) {
					setError(e.errcode === 48001
						? '当前公众号未开通「发布」接口权限（需认证服务号并开通群发/发布能力），已发布列表不可用。素材与草稿功能不受影响。'
						: e.message);
				}
				finally { setBusy(false); }
			}, [offset, reloadKey]);

			useEffect(() => { load(0); }, [reloadKey]);

			async function doDelete(id) {
				if (!window.confirm('确定删除该已发布文章？此操作不可逆。')) return;
				try { await api('/publish/delete', { method: 'POST', body: { articleId: id } }); setReloadKey(k => k + 1); }
				catch (e) { setError(e.message); }
			}

			return h('div', { className: 'wx-section' },
				h('div', { className: 'wx-toolbar' },
					h('span', { className: 'wx-muted' }, `共 ${total} 篇已发布文章`),
				),
				h(ErrorBar, { message: error }),
				busy ? h('div', { className: 'wx-muted' }, '加载中…') : null,
				list.length === 0 && !busy ? h(Empty, null, '暂无已发布文章') : null,
				h('div', { className: 'wx-list' }, list.map(item =>
					h('div', { className: 'wx-list-item', key: item.article_id },
						h('div', { className: 'wx-item-main' },
							h('div', { className: 'wx-item-title' }, (item.content?.news_item || [])[0]?.title || '(无标题)'),
							item.url ? h('a', { className: 'wx-small', href: item.url, target: '_blank', rel: 'noreferrer' }, '查看文章 ↗') : null,
						),
						h('div', { className: 'wx-item-actions' },
							h(Button, { variant: 'danger', onClick: () => doDelete(item.article_id) }, '删除'),
						),
					),
				)),
				h('div', { className: 'wx-pager' },
					h(Button, { disabled: offset === 0 || busy, onClick: () => load(Math.max(0, offset - 20)) }, '上一页'),
					h('span', { className: 'wx-muted' }, `第 ${Math.floor(offset / 20) + 1} 页`),
					h(Button, { disabled: offset + 20 >= total || busy, onClick: () => load(offset + 20) }, '下一页'),
				),
			);
		}

		function Settings({ status, refreshStatus }) {
			const [appId, setAppId] = useState('');
			const [appSecret, setAppSecret] = useState('');
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState('');
			const [msg, setMsg] = useState('');

			async function save() {
				setBusy(true); setError(''); setMsg('');
				try {
					await api('/credential', { method: 'POST', body: { appId, appSecret } });
					setAppSecret('');
					setMsg('已保存到侧边栏凭据保险箱');
					await refreshStatus();
				} catch (e) { setError(e.message); }
				finally { setBusy(false); }
			}

			async function clear() {
				if (!window.confirm('确定清除已保存的 AppID/AppSecret？')) return;
				try { await api('/credential', { method: 'DELETE' }); setMsg('已清除'); await refreshStatus(); }
				catch (e) { setError(e.message); }
			}

			async function verify() {
				setBusy(true); setError(''); setMsg('');
				try { const r = await api('/verify', { method: 'POST', body: {} }); setMsg(`连接成功：${r.account?.appid || '公众号'}`); }
				catch (e) { setError(e.message); }
				finally { setBusy(false); }
			}

			return h('div', { className: 'wx-section wx-settings' },
				h('div', { className: 'wx-status-card' },
					h('span', { className: 'wx-status-dot ' + (status?.configured ? 'on' : 'off') }),
					status?.configured ? '凭据已配置' : '尚未配置凭据',
				),
				h('p', { className: 'wx-muted wx-small' },
					'凭据保存在侧边栏「凭据保险箱」，不会写入插件配置或发送到微信以外的服务。',
				),
				h(ErrorBar, { message: error }),
				msg ? h('div', { className: 'wx-msg' }, msg) : null,
				h(Field, { label: 'AppID', hint: '公众号设置 → 基本配置 → 开发者ID(AppID)' },
					h('input', { type: 'text', value: appId, onChange: e => setAppId(e.target.value), placeholder: 'wx...' }),
				),
				h(Field, { label: 'AppSecret', hint: '仅保存在凭据保险箱，保存后此处不回显' },
					h('input', { type: 'password', value: appSecret, onChange: e => setAppSecret(e.target.value), placeholder: '输入 AppSecret' }),
				),
				h('div', { className: 'wx-toolbar' },
					h(Button, { variant: 'primary', onClick: save, disabled: busy || !appId || !appSecret }, '保存凭据'),
					h(Button, { onClick: verify, disabled: busy || !status?.configured }, '测试连接'),
					h(Button, { variant: 'danger', onClick: clear, disabled: busy || !status?.configured }, '清除'),
				),
				h('div', { className: 'wx-hint-box' },
					h('strong', null, '接入前准备：'),
					h('ul', null,
						h('li', null, '需认证服务号（订阅号/未认证号多数接口无权限）。'),
						h('li', null, '把本机公网出口 IP 加入「公众号设置 → 基本配置 → IP 白名单」。'),
						h('li', null, '素材、草稿、发布接口均通过官方 API 调用，浏览器不直接访问微信。'),
					),
				),
			);
		}

		// ---- 主面板 ----
		function WechatPanel() {
			const [tab, setTab] = useState('materials');
			const [status, setStatus] = useState(null);

			const refreshStatus = useCallback(async () => {
				try { setStatus(await api('/status')); }
				catch (e) { setStatus({ configured: false, error: e.message }); }
			}, []);
			useEffect(() => { refreshStatus(); }, [refreshStatus]);

			const tabs = [
				{ id: 'materials', label: '素材' },
				{ id: 'drafts', label: '草稿箱' },
				{ id: 'published', label: '已发布' },
				{ id: 'settings', label: '设置' },
			];

			return h('div', { className: 'wx-root' },
				h('div', { className: 'wx-tabs' }, tabs.map(t =>
					h('button', {
						key: t.id, className: 'wx-tab ' + (tab === t.id ? 'active' : ''),
						onClick: () => setTab(t.id),
					}, t.label),
				)),
				h('div', { className: 'wx-content' },
					tab === 'materials' ? h(Materials) : null,
					tab === 'drafts' ? h(Drafts, { onPublished: () => {} }) : null,
					tab === 'published' ? h(Published) : null,
					tab === 'settings' ? h(Settings, { status, refreshStatus }) : null,
				),
			);
		}

		const STYLE = `
.wx-root{display:flex;flex-direction:column;height:100%;font-size:13px;color:var(--dsw-alias-fg,#e6e6e6)}
.wx-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border,#333);padding:0 12px;flex:none}
.wx-tab{appearance:none;border:none;background:transparent;color:var(--dsw-alias-fg-muted,#999);padding:10px 12px;cursor:pointer;border-bottom:2px solid transparent}
.wx-tab.active{color:var(--dsw-alias-accent,#07c160);border-bottom-color:var(--dsw-alias-accent,#07c160)}
.wx-content{flex:1;overflow:auto;padding:16px}
.wx-section{display:flex;flex-direction:column;gap:12px}
.wx-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wx-spacer{flex:1}
.wx-muted{color:var(--dsw-alias-fg-muted,#888)}
.wx-small{font-size:12px}
.wx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.wx-card{border:1px solid var(--dsw-alias-border,#333);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px}
.wx-thumb{width:100%;height:96px;object-fit:cover;border-radius:4px;background:var(--dsw-alias-bg-soft,#222)}
.wx-card-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wx-card-actions{display:flex;gap:6px}
.wx-list{display:flex;flex-direction:column;gap:8px}
.wx-list-item{border:1px solid var(--dsw-alias-border,#333);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;align-items:stretch;gap:6px}
.wx-item-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.wx-item-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wx-item-actions{display:flex;gap:6px;flex:none;flex-wrap:wrap}
.wx-body-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.wx-seg{display:inline-flex;border:1px solid var(--dsw-alias-border,#444);border-radius:6px;overflow:hidden}
.wx-seg-btn{appearance:none;border:none;background:transparent;color:var(--dsw-alias-fg-muted,#999);padding:4px 12px;cursor:pointer;font-size:12px}
.wx-seg-btn.active{background:var(--dsw-alias-accent,#07c160);color:#fff}
.wx-preview{min-height:180px;max-height:360px;overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border,#444);border-radius:6px;background:var(--dsw-alias-bg,#fff);color:var(--dsw-alias-fg,#222);line-height:1.6}
.wx-preview img{max-width:100%}
.wx-section{min-height:100%}
.wx-pager{display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 8px;margin:8px -16px -16px;position:sticky;bottom:0;background:var(--dsw-alias-bg,#1e1e1e);border-top:1px solid var(--dsw-alias-border,#333);z-index:2}
.wx-btn{appearance:none;border:1px solid var(--dsw-alias-border,#444);background:var(--dsw-alias-bg-soft,#2a2a2a);color:inherit;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px}
.wx-btn:hover:not(:disabled){border-color:var(--dsw-alias-accent,#07c160)}
.wx-btn:disabled{opacity:.45;cursor:not-allowed}
.wx-btn-primary{background:var(--dsw-alias-accent,#07c160);border-color:var(--dsw-alias-accent,#07c160);color:#fff}
.wx-btn-danger{color:#ff6b6b}
.wx-icon-btn{appearance:none;border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px}
.wx-empty{padding:40px;text-align:center;color:var(--dsw-alias-fg-muted,#888)}
.wx-error{padding:8px 10px;border-radius:6px;background:rgba(255,80,80,.12);color:#ff8a8a}
.wx-msg{padding:8px 10px;border-radius:6px;background:rgba(7,193,96,.12);color:#5ddb96}
.wx-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1000}
.wx-modal{width:min(640px,92vw);max-height:88vh;overflow:auto;background:var(--dsw-alias-bg,#1e1e1e);border:1px solid var(--dsw-alias-border,#333);border-radius:10px}
.wx-modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border,#333)}
.wx-modal-body{padding:16px;display:flex;flex-direction:column;gap:12px}
.wx-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding-top:8px}
.wx-modal-wide{width:min(860px,94vw)}
.wx-article-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border,#333);padding-bottom:8px}
.wx-article-tab{appearance:none;border:1px solid var(--dsw-alias-border,#444);background:transparent;color:var(--dsw-alias-fg-muted,#999);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wx-article-tab.active{background:var(--dsw-alias-accent,#07c160);color:#fff;border-color:var(--dsw-alias-accent,#07c160)}
.wx-article-add{appearance:none;border:1px dashed var(--dsw-alias-border,#555);background:transparent;color:var(--dsw-alias-accent,#07c160);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
.wx-article-editor{display:flex;flex-direction:column;gap:10px}
.wx-article-bar{display:flex;gap:6px;flex-wrap:wrap}
.wx-check-row{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-fg-muted,#aaa)}
.wx-check-row label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.wx-rich{border:1px solid var(--dsw-alias-border,#444);border-radius:6px;overflow:hidden}
.wx-rich-toolbar{display:flex;gap:2px;flex-wrap:wrap;padding:4px;border-bottom:1px solid var(--dsw-alias-border,#444);background:var(--dsw-alias-bg-soft,#242424)}
.wx-rich-tool{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-fg,#ddd);min-width:28px;height:26px;padding:0 6px;border-radius:4px;cursor:pointer;font-size:12px}
.wx-rich-tool:hover{background:var(--dsw-alias-bg,#333);border-color:var(--dsw-alias-border,#555)}
.wx-rich-area{min-height:220px;max-height:420px;overflow:auto;padding:12px;outline:none;line-height:1.6;background:var(--dsw-alias-bg,#fff);color:var(--dsw-alias-fg,#222)}
.wx-rich-area img{max-width:100%}
.wx-rich-area blockquote{border-left:3px solid var(--dsw-alias-accent,#07c160);margin:8px 0;padding-left:12px;color:var(--dsw-alias-fg-muted,#888)}
.wx-cover-preview{max-width:180px;max-height:120px;object-fit:contain;border-radius:6px;margin-top:6px;border:1px solid var(--dsw-alias-border,#333)}
.wx-field{display:flex;flex-direction:column;gap:4px}
.wx-field-label{font-weight:600}
.wx-field-hint{font-size:11px;color:var(--dsw-alias-fg-muted,#888)}
.wx-field input,.wx-field textarea,.wx-field select,.wx-toolbar select{background:var(--dsw-alias-bg-soft,#2a2a2a);color:inherit;border:1px solid var(--dsw-alias-border,#444);border-radius:6px;padding:6px 8px;font:inherit}
.wx-status-card{display:flex;align-items:center;gap:8px;font-weight:600}
.wx-status-dot{width:9px;height:9px;border-radius:50%;background:#888}
.wx-status-dot.on{background:#07c160}
.wx-status-dot.off{background:#e0a800}
.wx-hint-box{border:1px solid var(--dsw-alias-border,#333);border-radius:8px;padding:10px 12px;color:var(--dsw-alias-fg-muted,#aaa);font-size:12px}
.wx-hint-box ul{margin:6px 0 0;padding-left:18px}
`;

		return {
			inject: ['slots', 'layout', 'locale'],
			apply(ctx) {
				const cleanups = [];
				cleanups.push(ctx.effect(() => {
					const el = document.createElement('style');
					el.id = 'wechat-panel-styles';
					el.textContent = STYLE;
					document.head.appendChild(el);
					return () => el.remove();
				}, 'wechat styles'));

				cleanups.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
					{ name: 'sidebar.panellist', id: PANEL_ID, order: 25, label: '微信公众号' },
					WechatSidebarIcon,
				)));

				cleanups.push(ctx.slots.inject('main', () => ctx.slots.register(
					{ name: 'main', key: PANEL_ID },
					WechatPanel,
				)));

				return () => cleanups.forEach(fn => fn?.());
			},
		};
	},
});
