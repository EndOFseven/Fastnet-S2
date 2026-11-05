let cadeia = Promise.resolve()

function comLock(fn) {
    const resultado = cadeia.then(fn, fn)
    cadeia = resultado.then(() => {}, () => {})
    return resultado
}

module.exports = { comLock }
