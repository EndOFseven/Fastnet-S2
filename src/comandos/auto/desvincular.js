const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { obterVinculo, desvincular } = require('../../auto/vinculo')

async function desvincularHandler(sock, msg, from, sender, text) {
    const prefix = config.prefix || '.'
    const cmd = String(text || '').trim().split(/\s+/)[0].toLowerCase()
    const nomes = [prefix + 'desvincular', prefix + 'desconectarapp', prefix + 'desconectar']
    if (!nomes.includes(cmd)) return false

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Esse comando só funciona em grupos.' }, { quoted: msg })
        return true
    }

    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}
    if (!isOwnerCheck(sender, msg) && !isAdm) {
        await sock.sendMessage(from, { text: '❌ Apenas administradores do grupo ou o Dono do bot podem desconectar o servidor.' }, { quoted: msg })
        return true
    }

    const atual = obterVinculo(from)
    if (!atual.centralCode) {
        await sock.sendMessage(from, { text: 'ℹ️ Este grupo não está ligado a nenhum servidor.' }, { quoted: msg })
        return true
    }

    const resultado = await desvincular(from)
    const msgOk = [
        '🤖 *SERVIDOR DESCONECTADO* ',
        '',
        '✅  A ligação foi removida.',
        `🔑  Servidor anterior: *${resultado.codigo || atual.centralCode}*`,
        '',
        `🔌  Para ligar de novo use *${prefix}vincular <codigo>*.`,
        '──────────────────'
    ].join('\n')

    await sock.sendMessage(from, { text: msgOk }, { quoted: msg })
    try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
    return true
}

desvincularHandler.nome = 'desvincular'
desvincularHandler.name = 'desvincular'
desvincularHandler.aliases = ['desconectarapp', 'desconectar']
desvincularHandler.categoria = 'auto'
desvincularHandler.subcategoria = 'AUTOMAÇÃO'
desvincularHandler.descricao = 'Remove o vínculo deste grupo com o servidor do aplicativo'
desvincularHandler.uso = `${config.prefix}desvincular`
desvincularHandler.apenasAdmin = true

module.exports = desvincularHandler
