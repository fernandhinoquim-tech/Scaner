// Calculadora segura para el buscador (sin eval): + - * / % ^ y paréntesis.
export function looksLikeMath(q) {
  const s = String(q).trim();
  return /^[\d\s+\-*/x×÷().,%^]+$/i.test(s) && /\d/.test(s) && /[+\-*/x×÷%^]/i.test(s.replace(/^-/, ''));
}

export function calculate(input) {
  const src = String(input)
    .replace(/×|x/gi, '*')
    .replace(/÷/g, '/')
    .replace(/\s+/g, '')
    .replace(/(\d),(\d)/g, '$1.$2');
  let i = 0;
  const peek = () => src[i];
  const eat = (c) => (src[i] === c ? (i++, true) : false);

  function number() {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) throw new Error('Número esperado');
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function primary() {
    if (eat('(')) {
      const v = expr();
      if (!eat(')')) throw new Error('Falta )');
      return v;
    }
    return number();
  }
  function unary() {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    let v = primary();
    while (peek() === '%' && !/[\d(]/.test(src[i + 1] || '')) {
      i++;
      v = v / 100;
    }
    return v;
  }
  function power() {
    const base = unary();
    if (eat('^')) return Math.pow(base, power());
    return base;
  }
  function term() {
    let v = power();
    for (;;) {
      if (eat('*')) v *= power();
      else if (eat('/')) v /= power();
      else if (peek() === '%') {
        i++;
        v %= power();
      } else return v;
    }
  }
  function expr() {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  }
  const v = expr();
  if (i !== src.length) throw new Error('Expresión inválida');
  if (!Number.isFinite(v)) throw new Error('Resultado no finito');
  return v;
}

export function formatNumber(v) {
  const r = Math.round(v * 1e10) / 1e10;
  return r.toLocaleString('es', { maximumFractionDigits: 10 });
}
