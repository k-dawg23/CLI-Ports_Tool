// Small transcript decoder for this experiment's fixed-size ConPTY viewport.
// Retains raw output separately; unsupported cursor operations fail verification.
export function terminalScreen(text, columns = 160, rows = 60) {
  let cells = Array.from({ length: rows }, () => Array(columns).fill(' '));
  let x = 0, y = 0;
  const down = () => { if (++y >= rows) { cells.shift(); cells.push(Array(columns).fill(' ')); y = rows - 1; } };
  const clamp = () => { x = Math.max(0, Math.min(columns - 1, x)); y = Math.max(0, Math.min(rows - 1, y)); };
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i);
    if (rest.startsWith('\x1b]')) {
      const end = /\x07|\x1b\\/.exec(rest);
      if (!end) break;
      i += end.index + end[0].length; continue;
    }
    if (rest.startsWith('\x1b[')) {
      const csi = /^\x1b\[([0-9;?]*)([ -/]*)([@-~])/.exec(rest);
      if (!csi) {
        if (/^\x1b\[[0-9;?]*[ -/]*$/.test(rest)) break; // Incomplete final chunk.
        throw new Error(`Unsupported terminal sequence: ${JSON.stringify(rest.slice(0, 20))}`);
      }
      i += csi[0].length;
      const [n = 1, m = 1] = csi[1].split(';').map(v => Number(v) || 1);
      const mode = Number(csi[1]) || 0;
      switch (csi[3]) {
        case 'H': case 'f': y = n - 1; x = m - 1; break;
        case 'A': y -= n; break; case 'B': y += n; break;
        case 'C': x += n; break; case 'D': x -= n; break;
        case 'E': y += n; x = 0; break; case 'F': y -= n; x = 0; break;
        case 'G': x = n - 1; break; case 'd': y = n - 1; break;
        case 'K': cells[y].fill(' ', mode === 1 || mode === 2 ? 0 : x, mode === 1 ? x + 1 : columns); break;
        case 'J':
          if (mode === 2 || mode === 3) cells = Array.from({ length: rows }, () => Array(columns).fill(' '));
          else if (mode === 0) { cells[y].fill(' ', x); for (let row = y + 1; row < rows; row++) cells[row].fill(' '); }
          else if (mode === 1) { for (let row = 0; row < y; row++) cells[row].fill(' '); cells[y].fill(' ', 0, x + 1); }
          break;
        case 'X': cells[y].fill(' ', x, Math.min(columns, x + n)); break;
        case 'P': cells[y].splice(x, n); while (cells[y].length < columns) cells[y].push(' '); break;
        case '@': cells[y].splice(x, 0, ...Array(n).fill(' ')); cells[y].length = columns; break;
        case 'm': case 'h': case 'l': case 't': break; // Attributes, modes, title/window notifications.
        default: throw new Error(`Unsupported terminal control: ${JSON.stringify(csi[0])}`);
      }
      clamp(); continue;
    }
    if (rest[0] === '\x1b') {
      if (rest.length === 1) break;
      throw new Error(`Unsupported terminal sequence: ${JSON.stringify(rest.slice(0, 2))}`);
    }
    const char = String.fromCodePoint(text.codePointAt(i)); i += char.length;
    if (char === '\r') x = 0;
    else if (char === '\n') down();
    else if (char === '\b') x = Math.max(0, x - 1);
    else if (char === '\t') x = Math.min(columns - 1, (Math.floor(x / 8) + 1) * 8);
    else if (char >= ' ' && char !== '\x7f') {
      if (x >= columns) { x = 0; down(); }
      cells[y][x++] = char;
    }
  }
  return cells.map(row => row.join('').trimEnd()).join('\n').trimEnd();
}
