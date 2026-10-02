/** Settings page for the plugin's row on DSH's Plugins page (`plugins.row.config`). */

import { useEffect, useState } from 'react'
import { SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

/** Package name and composition entry id; the row config slot is keyed `<package>#<row>`. */
export const PACKAGE_NAME = '@copylee/dsh-better-display'
export const ENTRY_ID = 'better-display'
export const ROW_CONFIG_KEY = `${PACKAGE_NAME}#${ENTRY_ID}`
/** Dictionary namespace for this page. */
export const LOCALE_NS = 'betterDisplay'

type ImageCount = 'auto' | 'limit'

/** Host-owned values and writes for this entry, as the Plugins page hands them over. */
export interface ConfigPageForm {
  readonly state: {
    status: 'loading' | 'ready' | 'unavailable'
    value: Record<string, unknown> | undefined
    revision: number | undefined
    writable: boolean
  }
  readonly mutate: (ops: readonly { op: 'set', path: readonly string[], value: unknown }[], expectedRevision?: number) => Promise<boolean>
}

export const zh = {
  title: 'dsh-better-display',
  summary: '图文并茂的回答：引用角标、来源面板与正文配图。',
  citations: '引用角标',
  citationsHint: '让模型用 [n](url) 标注联网来源，回答中显示为可点击的上标角标，末尾汇总「来源」面板。',
  inlineImages: '正文配图',
  selectionTools: '选中工具条',
  selectionToolsHint: '在回答中选中文字或图片后，可「添加到对话」（可编辑的引用卡片，公式保持可读）或「旁问」（不打扰主对话的一次性提问）。',
  userMarkdown: '渲染我的消息',
  userMarkdownHint: '自己发出的消息气泡也按 Markdown 显示：公式、引用、列表、代码。',
  inlineImagesHint: '让模型把搜到的相关图片嵌入回答（image_search / page_images / save_images 的结果）。',
  imageCount: '配图数量',
  imageCountHint: '「由 AI 决定」时模型按内容需要配图，不需要就不配；也可以限制每条回答的最多张数。',
  imageCountAuto: '由 AI 决定',
  imageCountLimit: '限制最多',
  maxImages: '最多张数',
  maxImagesHint: '每条回答最多配图张数（1–20），仅在「限制最多」时生效。',
  unavailable: '插件当前未加载，暂时无法配置。',
  readOnly: '本部署的设置为只读。',
  saveFailed: '保存失败，请重试。',
  saved: '已保存，下一条回答生效。',
}

export const en: typeof zh = {
  title: 'dsh-better-display',
  summary: 'Illustrated answers: citation chips, a sources panel and inline pictures.',
  citations: 'Citation chips',
  citationsHint: 'The model cites web sources as [n](url), shown as clickable superscripts with a sources panel at the end.',
  inlineImages: 'Inline pictures',
  selectionTools: 'Selection toolbar',
  selectionToolsHint: 'Select reply text or pictures to add them to the chat as an editable quote card, or ask a one-off side question.',
  userMarkdown: 'Render my messages',
  userMarkdownHint: 'Show your own message bubbles as Markdown: formulas, quotes, lists, code.',
  inlineImagesHint: 'The model embeds relevant pictures from image_search / page_images / save_images in its answer.',
  imageCount: 'Picture count',
  imageCountHint: 'With "Let AI decide" the model adds as many pictures as the answer needs, or none; or cap it per reply.',
  imageCountAuto: 'Let AI decide',
  imageCountLimit: 'Cap',
  maxImages: 'Maximum',
  maxImagesHint: 'Most pictures per reply (1-20); only used with "Cap".',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  readOnly: 'Settings are read-only in this deployment.',
  saveFailed: 'Saving failed; please try again.',
  saved: 'Saved; applies from the next answer.',
}

type Key = keyof typeof zh
type Translate = (key: Key) => string

const DEFAULTS = { citations: true, inlineImages: true, imageCount: 'auto' as ImageCount, maxImages: 8, selectionTools: true, userMarkdown: true }

/** Read the current values with defaults for anything unset. */
export function readValues(value: Record<string, unknown> | undefined) {
  const v = value ?? {}
  const max = typeof v.maxImages === 'number' && Number.isFinite(v.maxImages) ? Math.min(20, Math.max(1, Math.round(v.maxImages))) : DEFAULTS.maxImages
  return {
    citations: typeof v.citations === 'boolean' ? v.citations : DEFAULTS.citations,
    inlineImages: typeof v.inlineImages === 'boolean' ? v.inlineImages : DEFAULTS.inlineImages,
    imageCount: v.imageCount === 'limit' || v.imageCount === 'auto' ? v.imageCount : DEFAULTS.imageCount,
    maxImages: max,
    selectionTools: typeof v.selectionTools === 'boolean' ? v.selectionTools : DEFAULTS.selectionTools,
    userMarkdown: typeof v.userMarkdown === 'boolean' ? v.userMarkdown : DEFAULTS.userMarkdown,
  }
}

function Row({ label, hint, children, disabled }: { label: string, hint: string, children: React.ReactNode, disabled?: boolean | undefined }) {
  return (
    <div className="dsh-better-display__setting" data-disabled={disabled || undefined}>
      <div className="dsh-better-display__setting-text">
        <div className="dsh-better-display__setting-label">{label}</div>
        <div className="dsh-better-display__setting-hint">{hint}</div>
      </div>
      <div className="dsh-better-display__setting-control">{children}</div>
    </div>
  )
}

/** The row's one-liner (`summary`) or its settings form (`page`). */
export function DisplaySettings({ view, form, t }: { view: 'summary' | 'page', form?: ConfigPageForm | undefined, t: Translate }) {
  const [pending, setPending] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [maxText, setMaxText] = useState<string | null>(null)
  const accepted = form?.state.value
  useEffect(() => { setPending({}) }, [accepted])
  if (view === 'summary') return <>{t('summary')}</>
  if (form === undefined || form.state.status === 'unavailable') return <div className="dsh-better-display__setting-note">{t('unavailable')}</div>
  const values = readValues({ ...form.state.value, ...pending })
  const disabled = !form.state.writable || form.state.status !== 'ready'
  const write = (field: string, value: unknown) => {
    setPending(current => ({ ...current, [field]: value }))
    setStatus('idle')
    void form.mutate([{ op: 'set', path: [field], value }], form.state.revision)
      .then(ok => { setStatus(ok ? 'saved' : 'failed') }, () => { setStatus('failed') })
  }
  const commitMax = () => {
    if (maxText === null) return
    const parsed = Number.parseInt(maxText, 10)
    setMaxText(null)
    if (!Number.isFinite(parsed)) return
    const next = Math.min(20, Math.max(1, parsed))
    if (next !== values.maxImages) write('maxImages', next)
  }
  return (
    <div className="dsh-better-display__settings">
      {!form.state.writable && <div className="dsh-better-display__setting-note">{t('readOnly')}</div>}
      <Row label={t('citations')} hint={t('citationsHint')}>
        <Switch checked={values.citations} label={t('citations')} disabled={disabled} onChange={next => { write('citations', next) }} />
      </Row>
      <Row label={t('inlineImages')} hint={t('inlineImagesHint')}>
        <Switch checked={values.inlineImages} label={t('inlineImages')} disabled={disabled} onChange={next => { write('inlineImages', next) }} />
      </Row>
      <Row label={t('imageCount')} hint={t('imageCountHint')} disabled={!values.inlineImages}>
        <SegmentedControl<ImageCount>
          id="dsh-better-display-image-count"
          label={t('imageCount')}
          value={values.imageCount}
          disabled={disabled || !values.inlineImages}
          options={[
            { value: 'auto', label: t('imageCountAuto') },
            { value: 'limit', label: t('imageCountLimit') },
          ]}
          onChange={next => { write('imageCount', next) }}
        />
      </Row>
      <Row label={t('maxImages')} hint={t('maxImagesHint')} disabled={!values.inlineImages || values.imageCount !== 'limit'}>
        <input
          className="dsh-better-display__setting-number"
          type="number"
          min={1}
          max={20}
          step={1}
          aria-label={t('maxImages')}
          disabled={disabled || !values.inlineImages || values.imageCount !== 'limit'}
          value={maxText ?? String(values.maxImages)}
          onChange={event => { setMaxText(event.target.value) }}
          onBlur={commitMax}
          onKeyDown={event => { if (event.key === 'Enter') commitMax() }}
        />
      </Row>
      <Row label={t('selectionTools')} hint={t('selectionToolsHint')}>
        <Switch checked={values.selectionTools} label={t('selectionTools')} disabled={disabled} onChange={next => { write('selectionTools', next) }} />
      </Row>
      <Row label={t('userMarkdown')} hint={t('userMarkdownHint')}>
        <Switch checked={values.userMarkdown} label={t('userMarkdown')} disabled={disabled} onChange={next => { write('userMarkdown', next) }} />
      </Row>
      {status !== 'idle' && (
        <div className="dsh-better-display__setting-note" data-state={status}>{t(status === 'saved' ? 'saved' : 'saveFailed')}</div>
      )}
    </div>
  )
}
