const MAX_PART_MB = 10240
const MIN_PART_MB = 100

function normalizarMb(valor) {
    const n = Number(valor)
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.round(n)
}

function planejarPartes(mbTotal, opcoes = {}) {
    const total = normalizarMb(mbTotal)
    if (total <= 0) return []

    const maxPart = Math.max(1, normalizarMb(opcoes.maxPartMb) || MAX_PART_MB)
    const minPart = Math.max(1, normalizarMb(opcoes.minPartMb) || MIN_PART_MB)

    if (total <= maxPart) return [total]

    const partes = []
    let restante = total
    while (restante > 0) {
        const parte = Math.min(maxPart, restante)
        if (parte < minPart && partes.length > 0) {
            partes[partes.length - 1] += parte
            restante = 0
            break
        }
        partes.push(parte)
        restante -= parte
    }

    return partes
}

function totalDasPartes(partes) {
    return (Array.isArray(partes) ? partes : []).reduce((soma, parte) => soma + normalizarMb(parte), 0)
}

module.exports = {
    MAX_PART_MB,
    MIN_PART_MB,
    normalizarMb,
    planejarPartes,
    totalDasPartes
}
