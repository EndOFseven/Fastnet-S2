const config = require('../../../data/config.json')
const { isOwnerCheck, isAdmin } = require('../../utils/baileys')
const {
    BONUS_MB,
    VALOR_MINIMO,
    isPrimeiroBonusAtivo,
    setPrimeiroBonusAtivo,
    getEstadoHoje,
    formatarVolume,
    formatarPacoteComBonus
} = require('../../vendas/primeiroBonus')

module.exports = async function (sock, msg, from, sender, text) {
    const prefix = config.prefix
    const rawTokens = text.trim().split(/\s+/)
    const rawCmd = rawTokens[0].toLowerCase()

    if (
        rawCmd !== prefix + 'primeirobonus' &&
        rawCmd !== prefix + 'bonus1' &&
        rawCmd !== prefix + 'primeirocomprador'
    ) return false

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, {
            text: '❌ *Este comando funciona apenas dentro de grupos.*'
        }, { quoted: msg })
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch { }

    if (!isOwner && !isAdm) {
        await sock.sendMessage(from, {
            text: '❌ Só administradores podem usar o bônus do primeiro comprador.'
        }, { quoted: msg })
        return true
    }

    const subCmd = (rawTokens[1] || 'status').toLowerCase()

    if (subCmd === 'on' || subCmd === 'ativar' || subCmd === 'ligar') {
        setPrimeiroBonusAtivo(from, true)
        await sock.sendMessage(from, {
            text: [
                '✅ *BÔNUS 1º COMPRADOR ATIVADO*',
                '────────────────────────',
                `🎁 *Bônus:* +${BONUS_MB} MB`,
                `💵 *Valor mínimo:* ${VALOR_MINIMO} MT`,
                '📦 *Pacotes:* qualquer pacote de dados com valor total igual ou maior',
                '👤 *Elegível:* apenas o primeiro número do pedido',
                '🚫 *Saldo:* não participa do bônus',
                '📅 *Regra:* um vencedor por grupo a cada dia (Africa/Maputo)',
                '────────────────────────',
                '💡 _O bônus entra automaticamente na fila de entrega._'
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    if (subCmd === 'off' || subCmd === 'desativar' || subCmd === 'desligar') {
        setPrimeiroBonusAtivo(from, false)
        await sock.sendMessage(from, {
            text: [
                '❌ *BÔNUS 1º COMPRADOR DESATIVADO*',
                '────────────────────────',
                'O bônus deste grupo ficou pausado.',
                '',
                `💡 _Para religar:_ \`${prefix}primeirobonus on\``
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    if (subCmd !== 'status' && subCmd !== 'estado' && subCmd !== 'info') {
        await sock.sendMessage(from, {
            text: [
                '🎁 *BÔNUS 1º COMPRADOR • FASTNET*',
                '────────────────────────',
                `⚡ *Situação:* ${isPrimeiroBonusAtivo(from) ? '✅ ATIVO' : '❌ DESATIVADO'}`,
                `💵 *Valor mínimo:* ${VALOR_MINIMO} MT`,
                `🎁 *Bônus:* +${BONUS_MB} MB`,
                '────────────────────────',
                `💡 _Use:_ \`${prefix}primeirobonus on\`, \`${prefix}primeirobonus off\` ou \`${prefix}primeirobonus status\``
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    const estado = getEstadoHoje(from)
    const vencedor = estado.vencedor
    const numeroVencedor = vencedor?.clienteId
        ? vencedor.clienteId.split('@')[0].split(':')[0]
        : ''
    const pacoteVencedor = vencedor
        ? (Number(vencedor.pacoteBaseMb) > 0
            ? formatarPacoteComBonus(vencedor.pacoteBaseMb, vencedor.bonusMb || BONUS_MB)
            : formatarVolume(vencedor.pacoteTotalMb || 0))
        : ''

    const linhas = [
        '🎁 *BÔNUS 1º COMPRADOR • FASTNET*',
        '────────────────────────',
        `⚡ *Situação:* ${estado.ativo ? '✅ ATIVO' : '❌ DESATIVADO'}`,
        `📅 *Dia:* ${estado.dia}`,
        `💵 *Valor mínimo:* ${VALOR_MINIMO} MT`,
        `🎁 *Bônus:* +${BONUS_MB} MB`,
        '────────────────────────',
        vencedor
            ? `👑 *Vencedor de hoje:* ${vencedor.clienteNome || 'Cliente'} (@${numeroVencedor})`
            : '👑 *Vencedor de hoje:* Nenhum ainda',
        vencedor ? `📦 *Pacote:* ${pacoteVencedor}` : null,
        vencedor ? `🔥 *Sequência:* ${estado.vezesPrimeiro}x` : null,
        '────────────────────────',
        '📌 _Apenas o primeiro número do pedido; saldo não participa._'
    ].filter(Boolean)

    await sock.sendMessage(from, {
        text: linhas.join('\n'),
        mentions: vencedor?.clienteId ? [vencedor.clienteId] : []
    }, { quoted: msg })
    return true
}
