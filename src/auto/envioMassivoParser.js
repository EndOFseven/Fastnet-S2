function normalizarTelefone(raw) {
    const digitos = String(raw || '').replace(/\D/g, '')
    if (/^2588[45]\d{7}$/.test(digitos)) return digitos.slice(3)
    if (/^8[45]\d{7}$/.test(digitos)) return digitos
    return ''
}

function limparLinha(linha) {
    return String(linha || '')
        .replace(/^[\s•*\-–—>]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function extrairNumero(linha) {
    const semFormatacao = String(linha || '')
    let match = semFormatacao.match(/(?:\+?258[\s.-]?)?(8[45]\d{7})\b/)
    if (match) return { numero: match[1], resto: semFormatacao.slice(match.index + match[0].length) }

    match = semFormatacao.match(/(?:\+?258[\s.-]?)?(8[45](?:[\s.-]?\d){7})/)
    if (!match) return null
    return {
        numero: match[1].replace(/\D/g, ''),
        resto: semFormatacao.slice(match.index + match[0].length)
    }
}

function extrairPacote(resto) {
    const texto = String(resto || '')
        .replace(/^[\s\-–—:>➔→]+/, '')
        .trim()
    if (!texto) return ''

    const match = texto.match(/([\d.,]+)\s*(GB|G|MB|M|MTS?|MZN|METICAIS)\b/i)
    if (match) return `${match[1]}${match[2]}`
    return texto.split(/\s+/)[0] || ''
}

function parsearLista(texto) {
    const itens = []
    const erros = []
    const linhas = String(texto || '').split(/\r?\n/)

    for (const linhaOriginal of linhas) {
        const linha = limparLinha(linhaOriginal)
        if (!linha) continue

        const numeroExtraido = extrairNumero(linha)
        if (!numeroExtraido) continue

        const numero = normalizarTelefone(numeroExtraido.numero)
        if (!numero) {
            erros.push(`Número inválido: ${numeroExtraido.numero}`)
            continue
        }

        const pacote = extrairPacote(numeroExtraido.resto)
        if (!pacote) {
            erros.push(`Falta o pacote para ${numero}.`)
            continue
        }

        itens.push({ numero, pacote })
    }

    return { ok: erros.length === 0 && itens.length > 0, itens, erros }
}

module.exports = {
    normalizarTelefone,
    limparLinha,
    extrairNumero,
    extrairPacote,
    parsearLista
}
