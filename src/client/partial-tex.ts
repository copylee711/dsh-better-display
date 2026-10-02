/**
 * TeX for part of a rendered formula. KaTeX keeps no link from its glyphs back to the source, but
 * it renders the same parse tree twice: as HTML (what the user selects) and as MathML (hidden, for
 * screen readers). The formula's top-level atoms line up one to one between the two, so the atoms
 * a selection touches map to MathML nodes, and MathML converts back to TeX faithfully for what
 * answers use (fractions, scripts, roots, accents, braces, bold, text, operators, Greek). Anything
 * that does not line up or convert (matrices, aligned environments, …) yields `undefined`, and the
 * caller quotes the whole formula instead.
 */

/** Unicode operators and letters KaTeX emits, back to their commands. */
const SYMBOLS: Record<string, string> = {
  '⋅': '\\cdot', '×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '−': '-', '∗': '*', '∘': '\\circ',
  '≤': '\\le', '≥': '\\ge', '≠': '\\neq', '≈': '\\approx', '≡': '\\equiv', '∼': '\\sim', '≃': '\\simeq', '≅': '\\cong', '∝': '\\propto',
  '≪': '\\ll', '≫': '\\gg', '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset', '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq',
  '∪': '\\cup', '∩': '\\cap', '∖': '\\setminus', '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\land', '∨': '\\lor',
  '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow', '↦': '\\mapsto',
  '⟶': '\\longrightarrow', '⟹': '\\Longrightarrow', '⟺': '\\Longleftrightarrow', '↑': '\\uparrow', '↓': '\\downarrow',
  '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla', '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
  '∠': '\\angle', '⊥': '\\perp', '∥': '\\parallel', '∣': '\\mid', '′': '\'', '″': '\'\'', '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots',
  '⟨': '\\langle', '⟩': '\\rangle', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil', '‖': '\\|', '{': '\\{', '}': '\\}',
  'ℏ': '\\hbar', 'ℓ': '\\ell', 'ℜ': '\\Re', 'ℑ': '\\Im', '℘': '\\wp', '⊕': '\\oplus', '⊗': '\\otimes', '†': '\\dagger', '°': '^\\circ',
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ϵ': '\\epsilon', 'ε': '\\varepsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
  'ϑ': '\\vartheta', 'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ϖ': '\\varpi', 'ρ': '\\rho',
  'ϱ': '\\varrho', 'σ': '\\sigma', 'ς': '\\varsigma', 'τ': '\\tau', 'υ': '\\upsilon', 'ϕ': '\\phi', 'φ': '\\varphi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
}

/** Accent marks of `<mover accent>` and the commands that draw them. */
const ACCENTS: Record<string, string> = {
  '^': '\\hat', 'ˆ': '\\hat', '‾': '\\overline', '¯': '\\bar', 'ˉ': '\\bar', '→': '\\vec', '⃗': '\\vec', '˙': '\\dot', '¨': '\\ddot',
  '~': '\\tilde', '˜': '\\tilde', 'ˇ': '\\check', '˘': '\\breve', '⏞': '\\overbrace',
}

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'arg', 'gcd', 'Pr', 'hom'])

/** Invisible MathML characters (function application, invisible times, …). */
const INVISIBLE = /[⁡-⁤​]/g

class Unsupported extends Error {}

function text(node: Element): string {
  return (node.textContent ?? '').replace(INVISIBLE, '')
}

/** Concatenate TeX pieces, keeping a command from swallowing a following letter (`\cdot d`). */
function join(parts: readonly string[]): string {
  let out = ''
  for (const part of parts) {
    if (part === '') continue
    if (/\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z0-9]/.test(part)) out += ' '
    out += part
  }
  return out
}

function group(tex: string): string {
  return tex.length === 1 || /^\\[a-zA-Z]+$/.test(tex) ? tex : `{${tex}}`
}

function symbol(value: string): string {
  return [...value].map(char => SYMBOLS[char] ?? char).reduce((out, piece) => join([out, piece]), '')
}

function identifier(node: Element): string {
  const value = text(node)
  const variant = node.getAttribute('mathvariant')
  if ([...value].length > 1) return FUNCTIONS.has(value) ? `\\${value}` : `\\operatorname{${value}}`
  const plain = symbol(value)
  if (variant === 'bold' || variant === 'bold-italic') return `\\mathbf{${plain}}`
  if (variant === 'double-struck') return `\\mathbb{${plain}}`
  if (variant === 'script') return `\\mathcal{${plain}}`
  if (variant === 'fraktur') return `\\mathfrak{${plain}}`
  // Upright Latin letters (KaTeX marks Greek capitals "normal" too; those are upright anyway).
  if (variant === 'normal' && /^[A-Za-z]$/.test(value)) return `\\mathrm{${value}}`
  return plain
}

function children(node: Element): string {
  return join([...node.children].map(convert))
}

function convert(node: Element): string {
  const kids = [...node.children]
  switch (node.localName) {
    case 'mi': return identifier(node)
    case 'mn': return text(node)
    case 'mo': {
      const value = text(node)
      return value === '' ? '' : symbol(value)
    }
    case 'mtext': {
      const value = (node.textContent ?? '').replace(INVISIBLE, '')
      return value.trim() === '' ? (value === '' ? '' : '\\,') : `\\text{${value}}`
    }
    case 'mspace': {
      const width = node.getAttribute('width')
      return width === '1em' ? '\\quad' : width === '2em' ? '\\qquad' : '\\,'
    }
    case 'mrow': {
      // \left( … \right): a row fenced by stretchy delimiters.
      const open = kids[0]
      const close = kids.at(-1)
      if (kids.length >= 2 && open?.localName === 'mo' && close?.localName === 'mo' && open.getAttribute('fence') === 'true' && close.getAttribute('fence') === 'true') {
        const fence = (mark: Element) => { const value = text(mark); return value === '' ? '.' : symbol(value) }
        return join([`\\left${fence(open)}`, ...kids.slice(1, -1).map(convert), `\\right${fence(close)}`])
      }
      return children(node)
    }
    case 'mstyle': case 'mpadded': case 'semantics': return children(node)
    case 'mphantom': return ''
    case 'mfrac': return `\\frac{${convert(kids[0]!)}}{${convert(kids[1]!)}}`
    case 'msqrt': return `\\sqrt{${children(node)}}`
    case 'mroot': return `\\sqrt[${convert(kids[1]!)}]{${convert(kids[0]!)}}`
    case 'msup': return `${group(convert(kids[0]!))}^${group(convert(kids[1]!))}`
    case 'msub': return `${group(convert(kids[0]!))}_${group(convert(kids[1]!))}`
    case 'msubsup': return `${group(convert(kids[0]!))}_${group(convert(kids[1]!))}^${group(convert(kids[2]!))}`
    case 'mover': {
      const mark = text(kids[1]!)
      const accent = ACCENTS[mark]
      if (accent !== undefined) return `${accent}{${convert(kids[0]!)}}`
      return `\\overset{${convert(kids[1]!)}}{${convert(kids[0]!)}}`
    }
    case 'munder': {
      const mark = text(kids[1]!)
      if (mark === '⏟') return `\\underbrace{${convert(kids[0]!)}}`
      if (mark === '‾' || mark === '_') return `\\underline{${convert(kids[0]!)}}`
      // An underbrace with its label: munder(munder(body, ⏟), label).
      if (kids[0]!.localName === 'munder' && text(kids[0]!.children[1]!) === '⏟') return `\\underbrace{${convert(kids[0]!.children[0]!)}}_${group(convert(kids[1]!))}`
      const base = convert(kids[0]!)
      return /^\\(sum|prod|int|lim|max|min|bigcup|bigcap)/.test(base) ? `${base}_${group(convert(kids[1]!))}` : `\\underset{${convert(kids[1]!)}}{${base}}`
    }
    case 'munderover': return `${convert(kids[0]!)}_${group(convert(kids[1]!))}^${group(convert(kids[2]!))}`
    case 'menclose': return node.getAttribute('notation')?.includes('box') === true ? `\\boxed{${children(node)}}` : children(node)
    default: throw new Unsupported(node.localName)
  }
}

/** A formula's top-level MathML nodes (spacing and invisible operators dropped). */
function mathAtoms(katex: Element): Array<{ node: Element, space: string }> | undefined {
  const semantics = katex.querySelector('math > semantics')
  const body = semantics?.firstElementChild
  if (body === null || body === undefined) return undefined
  const top = body.localName === 'mrow' ? [...body.children] : [body]
  const atoms: Array<{ node: Element, space: string }> = []
  // Spacing (`\,`, `\quad`) has no rendered atom of its own: it rides on the next atom.
  let space = ''
  for (const node of top) {
    if (node.localName === 'mo' && text(node) === '') continue
    if (node.localName === 'mspace' || (node.localName === 'mtext' && (node.textContent ?? '').trim() === '')) {
      space += convert(node)
      continue
    }
    atoms.push({ node, space })
    space = ''
  }
  return atoms
}

/** A formula's top-level rendered atoms (struts and spacing dropped). */
function htmlAtoms(katex: Element): Element[] {
  const html = katex.querySelector('.katex-html')
  if (html === null) return []
  const atoms: Element[] = []
  // KaTeX 0.18 prefixes these classes (`katex-base`, `katex-strut`); older releases do not.
  const is = (element: Element, name: string) => element.classList.contains(name) || element.classList.contains(`katex-${name}`)
  for (const base of html.children) {
    if (!is(base, 'base')) continue
    for (const atom of base.children) {
      if (is(atom, 'strut') || is(atom, 'mspace') || is(atom, 'newline')) continue
      atoms.push(atom)
    }
  }
  return atoms
}

const squash = (value: string) => value.replace(INVISIBLE, '').replace(/\s+/g, '')

/**
 * Pair rendered atoms with MathML nodes. Mostly one to one; a multi-digit number is one `<mn>`
 * but may be several rendered digits, so those are merged by text.
 */
function align(html: readonly Element[], math: ReadonlyArray<{ node: Element, space: string }>): Array<{ html: Element[], math: Element, space: string }> | undefined {
  const pairs: Array<{ html: Element[], math: Element, space: string }> = []
  let index = 0
  for (const { node, space } of math) {
    const first = html[index]
    if (first === undefined) return undefined
    const group = [first]
    index++
    if (node.localName === 'mn') {
      const target = squash(node.textContent ?? '')
      let joined = squash(first.textContent ?? '')
      while (joined !== target && html[index] !== undefined && target.startsWith(joined + squash(html[index]!.textContent ?? ''))) {
        joined += squash(html[index]!.textContent ?? '')
        group.push(html[index]!)
        index++
      }
    }
    pairs.push({ html: group, math: node, space })
  }
  return index === html.length ? pairs : undefined
}

/**
 * TeX of the part of a formula a range covers, or `undefined` when the whole formula is covered
 * or the part cannot be converted reliably.
 * @param katex - the formula's `.katex` element.
 */
export function partialTex(katex: Element, range: Range): string | undefined {
  const math = mathAtoms(katex)
  if (math === undefined) return undefined
  const pairs = align(htmlAtoms(katex), math)
  if (pairs === undefined) return undefined
  const touched = pairs.map(pair => pair.html.some(atom => range.intersectsNode(atom)))
  const first = touched.indexOf(true)
  const last = touched.lastIndexOf(true)
  if (first === -1 || (first === 0 && last === pairs.length - 1)) return undefined
  try {
    const tex = join(pairs.slice(first, last + 1).flatMap((pair, index) => index === 0 ? [convert(pair.math)] : [pair.space, convert(pair.math)])).trim()
    return tex === '' ? undefined : tex
  } catch (error) {
    if (error instanceof Unsupported) return undefined
    throw error
  }
}

/** Exposed for tests: TeX of a whole MathML node. */
export function mathmlToTex(node: Element): string | undefined {
  try {
    return convert(node)
  } catch (error) {
    if (error instanceof Unsupported) return undefined
    throw error
  }
}
