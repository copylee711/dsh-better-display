/** UI strings of the quote and side-question features; DSH ships zh/en, follow the page language. */

const ZH = {
  addToChat: '添加到对话',
  addImage: '添加图片',
  sideQuestion: '旁问',
  quote: '引用',
  edit: '编辑',
  done: '完成',
  remove: '移除',
  expand: '展开',
  collapse: '收起',
  images: '{n} 张图片已作为附件加入',
  imageFailed: '图片加入失败：{error}',
  composerBusy: '输入框正忙，请稍后再试',
  noSession: '当前没有可用的会话',
  askTitle: '旁问',
  askPlaceholder: '关于这段内容想问什么？（Enter 发送，Shift+Enter 换行）',
  explain: '解释一下',
  send: '发送',
  cancel: '取消',
  thinking: '思考中…',
  copy: '复制',
  copied: '已复制',
  close: '关闭',
  sideUnavailable: '旁问需要 DSH 的 fork 子代理支持，当前环境不可用',
  sideFailed: '旁问失败：{error}',
}

const EN: typeof ZH = {
  addToChat: 'Add to chat',
  addImage: 'Add image',
  sideQuestion: 'Ask aside',
  quote: 'Quote',
  edit: 'Edit',
  done: 'Done',
  remove: 'Remove',
  expand: 'Expand',
  collapse: 'Collapse',
  images: '{n} image(s) attached',
  imageFailed: 'Could not attach the image: {error}',
  composerBusy: 'The composer is busy, try again in a moment',
  noSession: 'No conversation is open',
  askTitle: 'Ask aside',
  askPlaceholder: 'What do you want to know about this? (Enter to send, Shift+Enter for a new line)',
  explain: 'Explain this',
  send: 'Send',
  cancel: 'Cancel',
  thinking: 'Thinking…',
  copy: 'Copy',
  copied: 'Copied',
  close: 'Close',
  sideUnavailable: 'Side questions need DSH fork subagents, which this host does not provide',
  sideFailed: 'Side question failed: {error}',
}

export type LabelKey = keyof typeof ZH

export function isChinese(): boolean {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang || navigator.language
  return lang.toLowerCase().startsWith('zh')
}

/** Look up one string, filling `{name}` placeholders. */
export function label(key: LabelKey, values: Record<string, string | number> = {}): string {
  const text = (isChinese() ? ZH : EN)[key]
  return text.replace(/\{(\w+)\}/g, (all, name: string) => name in values ? String(values[name]) : all)
}
