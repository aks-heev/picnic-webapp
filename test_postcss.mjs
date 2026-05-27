import { readFileSync } from 'fs'
import postcss from './node_modules/postcss/lib/postcss.js'

const css = readFileSync('style.css', 'utf8')
try {
  const root = postcss.parse(css)
  console.log('Parsed OK, nodes:', root.nodes.length)
} catch(e) {
  console.log('Error at line', e.line, 'col', e.column, ':', e.reason)
  const lines = css.split('\n')
  const start = Math.max(0, e.line - 5)
  const end = Math.min(lines.length, e.line + 3)
  for (let i = start; i < end; i++) {
    console.log((i+1) + ': ' + JSON.stringify(lines[i]))
  }
}
