const config = require('../../../data/config.json')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys.js')
const verificacao = require('../../vendas/verificacao')
const { recusarPendente } = require('../../vendas/aprovacao')

module.exports = async (sock, msg, from, sender, text) => {
    const prefix = config.prefix || '.'
    if (!String(text || '').startsWith(prefix + 'recusar')) return false

    const reply = (texto) => sock.sendMessage(from, { text: texto }, { quoted: msg })

    if (!from.endsWith('@g.us')) {
        await reply('❌ Este comando funciona apenas em grupos!')
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdmin = false
    try {
        if (!isOwner) isAdmin = await checkIsAdmin(sock, from, sender)
    } catch { }

    if (!isAdmin && !isOwner) {
        await reply('❌ Apenas administradores podem recusar comprovativos!')
        return true
    }

    const codigo = String(text).trim().split(/\s+/)[1]
    if (!codigo) {
        await reply(`⚠️ *CÓDIGO EM FALTA*\n──────────────────\n▸ Uso: \`${prefix}recusar CÓDIGO\`\n▸ Veja os pendentes com \`${prefix}confirmar\`.`)
        return true
    }

    const pendente = verificacao.buscarPendente(from, codigo)
    if (!pendente) {
        await reply(`⚠️ *NÃO ENCONTRADO*\n──────────────────\n▸ Não existe comprovativo pendente com o código *${codigo}* neste grupo.`)
        return true
    }

    await recusarPendente(sock, pendente, {
        motivo: 'recusado_pelo_admin',
        porJid: sender
    })

    return true
}

module.exports.nome = 'recusar'
module.exports.aliases = ['recusarcomprovante', 'rejeitarcomprovante']
module.exports.categoria = 'adm'
module.exports.subcategoria = 'VENDAS & COMPROVANTES'
module.exports.descricao = 'Recusa um comprovativo em conferência e bloqueia a reutilização do código'
module.exports.uso = '.recusar [código]'
