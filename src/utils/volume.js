function formatarVolumeCurto(mb, preferirGb = false) {
    const valor = Math.max(0, Number(mb) || 0)
    if (valor >= 1024 || preferirGb) {
        const gb = valor / 1024
        const texto = Number.isInteger(gb) ? String(gb) : gb.toFixed(1).replace('.', ',')
        return `${texto}GB`
    }
    return `${Math.round(valor)}MB`
}

module.exports = { formatarVolumeCurto }
