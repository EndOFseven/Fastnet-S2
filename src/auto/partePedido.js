const { MAX_PART_MB } = require('./planejadorPartes')

function baseMbDoPedido(pedido) {
    const exibicao = Math.max(0, Number(pedido?.mbExibicao) || 0)
    const base = exibicao > 0 ? exibicao : Math.max(0, Number(pedido?.megasAmount) || 0)
    return Math.min(MAX_PART_MB, base)
}

module.exports = {
    baseMbDoPedido
}
