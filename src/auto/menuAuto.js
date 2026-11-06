function montarSecaoAuto(prefix, opts = {}) {
    const vinculo = opts.vinculo || { centralCode: null, autoAtivo: false }
    const podeGerir = Boolean(opts.isDono || opts.isAdmin)
    const linhas = []

    if (podeGerir) {
        if (vinculo.centralCode && vinculo.autoAtivo) {
            linhas.push(`📤 ${prefix}enviarauto <numero> <pacote>`)
            linhas.push(`▸ ${prefix}pagamentoauto on/off`)
            linhas.push(`📡 ${prefix}envio massivo`)
            linhas.push(`📋 ${prefix}fila`)
            linhas.push(`🔌 ${prefix}desvincular`)
        } else {
            linhas.push(`🔌 ${prefix}vincular <codigo>`)
        }
    }

    linhas.push(`📖 ${prefix}menuauto`)

    const status = vinculo.centralCode
        ? `Servidor: *${vinculo.centralCode}* • ${vinculo.autoAtivo ? 'ATIVO' : 'INATIVO'}`
        : 'Nenhum servidor conectado'

    return [
        '*🤖 AUTOMAÇÃO VIA APP*',
        '',
        `${status}`,
        ...linhas,
        '──────────────────'
    ].join('\n')
}

module.exports = { montarSecaoAuto }
