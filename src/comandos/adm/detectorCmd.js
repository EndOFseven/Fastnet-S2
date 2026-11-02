const config = require('../../../data/config.json')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys.js')
const configManager = require('../../utils/configManager')

const handler = async (sock, msg, from, sender, text) => {
    const rawCmd = (text || '').trim().toLowerCase().split(/\s+/)[0]
    if (rawCmd !== config.prefix + 'detector') return false

    const isGroup = from.endsWith('@g.us')
    const reply = (texto) => sock.sendMessage(from, { text: texto }, { quoted: msg })

    if (!isGroup) {
        await reply('❌ Este recurso funciona apenas em grupos!')
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdmin = false
    try {
        if (!isOwner) isAdmin = await checkIsAdmin(sock, from, sender)
    } catch { }

    if (!isAdmin && !isOwner) {
        await reply('❌ Somente administradores do grupo podem ajustar o detector de comprovativos!')
        return true
    }

    const groupConfig = configManager.loadGroupConfig()
    if (!groupConfig[from]) groupConfig[from] = {}

    const args = text.trim().split(/\s+/)
    const action = args[1]?.toLowerCase()

    if (!action) {
        const estaAtivo = groupConfig[from].detector !== false
        const statusIcon = estaAtivo ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        const desc = estaAtivo
            ? 'O bot lê comprovativos automaticamente (imagem, PDF e texto).'
            : 'A leitura de comprovativos está PAUSADA neste grupo. As demais funções seguem normais.'

        const msgStatus = [
            '🔍 *DETECTOR DE COMPROVATIVOS*',
            '────────────────────────',
            `📊 *Status:* ${statusIcon}`,
            '',
            `ℹ️ ${desc}`,
            '',
            '⚙️ *Para mudar:*',
            `• \`${config.prefix}detector on\` _(Liga a leitura automática)_`,
            `• \`${config.prefix}detector off\` _(Desliga a leitura automática)_`
        ].join('\n')

        await reply(msgStatus)
        return true
    }

    if (action === 'on' || action === 'ativar' || action === '1' || action === 'true') {
        groupConfig[from].detector = true
        configManager.saveGroupConfig(true)

        await reply([
            '✅ *DETECTOR DE COMPROVATIVOS ATIVADO!*',
            '────────────────────────',
            '🟢 O bot retomou a leitura e a validação de comprovativos neste grupo (imagens, PDFs e texto).',
            '⚡ As vendas automáticas seguem funcionando!'
        ].join('\n'))
        return true
    }

    if (action === 'off' || action === 'desativar' || action === '0' || action === 'false') {
        groupConfig[from].detector = false
        configManager.saveGroupConfig(true)

        await reply([
            '🛑 *DETECTOR DE COMPROVATIVOS DESATIVADO!*',
            '────────────────────────',
            '🔴 O bot não lê nem responde a comprovativos neste grupo.',
            'ℹ️ Os outros comandos e recursos seguem ativos.',
            `💡 _Para ligar de novo, envie:_ \`${config.prefix}detector on\``
        ].join('\n'))
        return true
    }

    await reply(`⚠️ Opção inválida! Use:\n• \`${config.prefix}detector on\`\n• \`${config.prefix}detector off\``)
    return true
}

handler.nome = 'detector'
handler.aliases = []
handler.categoria = 'adm'
handler.subcategoria = 'AUTOMAÇÃO & SISTEMA'
handler.descricao = 'Pausa ou ativa a leitura e validação automática de comprovantes no grupo'
handler.uso = `${config.prefix}detector [on/off]`

module.exports = handler
