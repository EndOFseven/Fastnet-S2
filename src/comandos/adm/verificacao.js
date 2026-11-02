const config = require('../../../data/config.json')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys.js')
const verificacao = require('../../vendas/verificacao')

const ROTULOS = {
    firebase: 'SMS OFICIAL (confirma na conta da operadora)',
    manual: 'MANUAL (tudo confirmado por administrador)',
    auto: 'AUTOMÁTICO (aprova tudo — legado)'
}

module.exports = async (sock, msg, from, sender, text) => {
    const prefix = config.prefix || '.'
    if (!String(text || '').startsWith(prefix + 'verificacao')) return false

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
        await reply('❌ Apenas administradores podem ajustar a verificação de comprovantes!')
        return true
    }

    const arg = String(text).trim().split(/\s+/)[1]?.toLowerCase()
    const modoAtual = verificacao.getModo(from)
    const pendentes = verificacao.listarPendentes(from).length

    if (arg) {
        if (arg === 'auto' && !isOwner) {
            await reply('❌ Apenas o Dono do bot pode ativar o modo AUTOMÁTICO (aprova tudo sem conferir pagamento).')
            return true
        }
        if (!verificacao.setModo(from, arg)) {
            await reply(`⚠️ *MODO INVÁLIDO*\n──────────────────\n▸ Use: \`${prefix}verificacao firebase\`, \`${prefix}verificacao manual\` ou \`${prefix}verificacao auto\`.`)
            return true
        }
        await reply([
            '✅ *VERIFICAÇÃO ATUALIZADA*',
            '──────────────────',
            `📊 *Modo:* ${ROTULOS[arg]}`,
            '',
            arg === 'firebase'
                ? '🛡️ O pagamento só é aceite se o SMS oficial da operadora existir na conta do app.'
                : arg === 'manual'
                    ? '🛡️ Todo comprovativo fica retido até um administrador usar `.confirmar`.'
                    : '⚠️ Comprovativos serão aprovados sem confirmação de pagamento.'
        ].join('\n'))
        return true
    }

    await reply([
        '🔎 *VERIFICAÇÃO DE COMPROVANTES*',
        '──────────────────',
        `📊 *Modo atual:* ${ROTULOS[modoAtual]}`,
        `📥 *Em conferência agora:* ${pendentes}`,
        '──────────────────',
        '⚙️ *Modos disponíveis:*',
        `• \`${prefix}verificacao firebase\` — exige SMS oficial da operadora _(recomendado)_`,
        `• \`${prefix}verificacao manual\` — exige confirmação de um administrador`,
        `• \`${prefix}verificacao auto\` — aprova tudo _(legado, menos seguro)_`,
        '──────────────────',
        `✅ \`${prefix}confirmar\` — ver pendentes e forçar aprovação`,
        `❌ \`${prefix}recusar CÓDIGO\` — rejeitar um comprovativo`
    ].join('\n'))

    return true
}

module.exports.nome = 'verificacao'
module.exports.aliases = ['verificarcomprovante', 'modoverificacao']
module.exports.categoria = 'adm'
module.exports.subcategoria = 'VENDAS & COMPROVANTES'
module.exports.descricao = 'Define como os comprovativos são validados antes da entrega automática'
module.exports.uso = '.verificacao [firebase/manual/auto]'
