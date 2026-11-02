const config = require('../../../data/config.json')
const { isOwnerCheck, isSubdonoCheck } = require('../../utils/baileys')
const { getAuthorizedGroupsList } = require('../../utils/groupResolver')

module.exports = async function(sock, msg, from, sender, text) {
    const cmd = text.trim().toLowerCase().split(/\s+/)[0]
    if (cmd !== config.prefix + 'grupos' && cmd !== config.prefix + 'listagrupos') {
        return false
    }

    const isOwner = isOwnerCheck(sender, msg) || isSubdonoCheck(sender)
    if (!isOwner) {
        await sock.sendMessage(from, { text: '❌ Só o dono e os sub-donos podem ver a lista de grupos.' }, { quoted: msg })
        return true
    }

    const groups = getAuthorizedGroupsList()
    if (groups.length === 0) {
        await sock.sendMessage(from, { text: 'ℹ️ Não há grupos autorizados no sistema.' }, { quoted: msg })
        return true
    }

    let txt = '👥 *GRUPOS LIBERADOS*\n────────────────────────\n'
    txt += '📊 *Quantidade:* ' + groups.length + '\n\n'

    groups.forEach((g) => {
        const validade = g.cfg.expiraEm ? ('Expira em ' + Math.max(0, Math.floor((g.cfg.expiraEm - Date.now()) / (24 * 3600 * 1000))) + 'd') : 'Vitalício'

        txt += '*' + g.index + '️⃣ ' + g.name + '*\n'
        txt += '   ├ 🆔 *ID:* `' + g.id + '`\n'
        txt += '   └ ⏳ *Licença:* ' + validade + '\n\n'
    })

    txt += '────────────────────────\n'
    txt += '💡 *Comandos por grupo:*\n'
    txt += `• ${config.prefix}filas [nº] ➔ Ver a fila do grupo X\n`
    txt += `• ${config.prefix}compras [nº] ➔ Ver as compras do grupo X\n`
    txt += `• ${config.prefix}gerarlicenca grupo [nº] [tempo] ➔ Gerar licença para o Grupo X`

    await sock.sendMessage(from, { text: txt.trim() }, { quoted: msg })
    return true
}
