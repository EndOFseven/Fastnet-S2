function formatarComandoIncorreto(motivo, usoExemplo) {
    const lines = [
        '❌ *COMANDO INCORRETO*',
        '──────────────────'
    ]
    if (motivo) {
        lines.push(`▸ ${motivo}`)
    }
    if (usoExemplo) {
        lines.push(`▸ Use: ${usoExemplo}`)
    }
    return lines.join('\n')
}

function formatarCaixaAviso(titulo, conteudo, emoji = '⚠️') {
    const lines = [
        `${emoji} *${String(titulo).toUpperCase()}*`,
        '──────────────────'
    ]
    if (Array.isArray(conteudo)) {
        for (const c of conteudo) {
            lines.push(`▸ ${c}`)
        }
    } else if (conteudo) {
        lines.push(`▸ ${conteudo}`)
    }
    return lines.join('\n')
}

module.exports = {
    formatarComandoIncorreto,
    formatarCaixaAviso
}
