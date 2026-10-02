// @vitest-environment jsdom

import katex from 'katex'
import { afterEach, describe, expect, it } from 'vitest'
import { mathmlToTex, partialTex } from '../src/client/partial-tex.ts'

function mount(tex: string, displayMode = false): Element {
  document.body.innerHTML = katex.renderToString(tex, { displayMode, throwOnError: true })
  return document.querySelector('.katex')!
}

/** MathML of a TeX string, without the annotation (which repeats the source). */
function mathml(tex: string): string {
  const html = katex.renderToString(tex, { throwOnError: true })
  return html.slice(html.indexOf('<mrow>'), html.indexOf('<annotation'))
}

afterEach(() => { document.body.innerHTML = '' })

const FORMULAS = [
  String.raw`d\Phi=\mathbf E\cdot d\mathbf A=E\,dA\cos\theta`,
  String.raw`\frac{q}{4\pi\varepsilon_0}\cdot\underbrace{\frac{dA\cos\theta}{r^2}}_{d\Omega}`,
  String.raw`\oint_S \mathbf E\cdot d\mathbf A=\frac{Q_{\text{enc}}}{\varepsilon_0}`,
  String.raw`\sum_{i=1}^n a_i^2\le\left(\sum_i a_i\right)^2`,
  String.raw`\vec F=m\vec a,\quad \hat n\perp S`,
  String.raw`\sqrt{x^2+y^2}+\sqrt[3]{8}=42.5`,
  String.raw`P(A_k\mid B)=\frac{P(A_k)P(B\mid A_k)}{\sum_i P(A_i)P(B\mid A_i)}`,
  String.raw`\boxed{E=mc^2}`,
  String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`,
]

describe('MathML back to TeX', () => {
  it.each(FORMULAS)('round-trips %s', tex => {
    const body = mount(tex).querySelector('math > semantics')!.firstElementChild!
    const back = mathmlToTex(body)!
    expect(back).toBeDefined()
    // Same MathML from the reconstructed source: the same formula.
    expect(mathml(back)).toBe(mathml(tex))
  })
})

describe('part of a formula', () => {
  /** A range over the rendered atoms `from`..`to` (indexes among the visible atoms). */
  function select(formula: Element, from: number, to: number): Range {
    const atoms = [...formula.querySelectorAll('.katex-html > .katex-base > *')].filter(atom => !atom.classList.contains('katex-strut') && !atom.classList.contains('mspace'))
    const range = document.createRange()
    range.setStart(atoms[from]!, 0)
    range.setEnd(atoms[to]!, atoms[to]!.childNodes.length)
    return range
  }

  it('quotes just the atoms the selection touches', () => {
    const formula = mount(String.raw`d\Phi=\mathbf E\cdot d\mathbf A=E\,dA\cos\theta`, true)
    // dΦ = E·dA =
    expect(partialTex(formula, select(formula, 0, 7))).toBe(String.raw`d\Phi=\mathbf{E}\cdot d\mathbf{A}=`)
    // E dA cos θ
    expect(partialTex(formula, select(formula, 8, 12))).toBe(String.raw`E\,dA\cos\theta`)
  })

  it('takes structures whole and keeps multi-digit numbers together', () => {
    const formula = mount(String.raw`x=\frac{a}{b}+42.5`)
    expect(partialTex(formula, select(formula, 2, 2))).toBe(String.raw`\frac{a}{b}`)
    const atoms = formula.querySelectorAll('.katex-html > .katex-base > :not(.katex-strut):not(.mspace)').length
    expect(partialTex(formula, select(formula, 3, atoms - 1))).toBe('+42.5')
  })

  it('leaves whole selections and unconvertible formulas to the caller', () => {
    const whole = mount(String.raw`a+b`)
    const range = document.createRange()
    range.selectNodeContents(whole)
    expect(partialTex(whole, range)).toBeUndefined()
    const matrix = mount(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}+x`)
    expect(partialTex(matrix, select(matrix, 0, 0))).toBeUndefined()
  })
})
