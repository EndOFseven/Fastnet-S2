const fs = require('fs')
const path = require('path')
const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { obterVinculo } = require('../../auto/vinculo')
const { montarSecaoAuto } = require('../../auto/menuAuto')
const { getModo } = require('../../vendas/verificacao')

async function menuAutoHandler(sock, msg, from, sender, text) {
    const prefix = config.prefix || '.'
    const cmd = String(text || '').trim().split(/\s+/)[0].toLowerCase()
    const nomes = [prefix + 'menuauto', prefix + 'comandosauto', prefix + 'auto']
    if (!nomes.includes(cmd)) return false

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Esse comando só funciona em grupos.' }, { quoted: msg })
        return true
    }

    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}
    if (!isOwnerCheck(sender, msg) && !isAdm) {
        await sock.sendMessage(from, { text: '❌ Apenas administradores do grupo ou o Dono do bot podem ver o painel de automação.' }, { quoted: msg })
        return true
    }

    const vinculo = obterVinculo(from)
    const secao = montarSecaoAuto(prefix, { vinculo })
    const rotulosModo = { firebase: 'SMS OFICIAL', manual: 'MANUAL', auto: 'AUTOMÁTICO' }
    const modoVerificacao = rotulosModo[getModo(from)] || 'SMS OFICIAL'

    const detalhes = [
        '*📖 ENTENDA O FUNCIONAMENTO*',
        '',
        '1️⃣ O app FastNet S2 exibe o código do servidor.',
        `2️⃣ O admin manda *${prefix}vincular <codigo>*.`,
        `3️⃣ Comprovativo confirmado pelo SMS da operadora ou *${prefix}enviarauto* criam o pedido sozinhos.`,
        '4️⃣ O app processa por USSD e o bot informa neste grupo.',
        '──────────────────',
        '*🔎 SEGURANÇA DE COMPROVANTES*',
        '',
        `▸ Modo: *${modoVerificacao}*`,
        `▸ ${prefix}verificacao [firebase/manual/auto]`,
        `▸ ${prefix}confirmar CÓDIGO`,
        `▸ ${prefix}recusar CÓDIGO`,
        '──────────────────',
        '*PAGAMENTO AUTOMÁTICO E-MOLA*',
        '',
        `▸ ${prefix}pagamentoauto on/off/status`,
        '_Usa o número Vodacom no campo Conteudo do SMS._',
        '──────────────────'
    ].join('\n')

    const textoFinal = `${secao}\n\n${detalhes}`
    const logoPath = path.join(__dirname, '../../../assets', 'menuadm.jpg')

    if (fs.existsSync(logoPath)) {
        await sock.sendMessage(from, { image: fs.readFileSync(logoPath), caption: textoFinal }, { quoted: msg })
    } else {
        await sock.sendMessage(from, { text: textoFinal }, { quoted: msg })
    }
    return true
}

menuAutoHandler.nome = 'menuauto'
menuAutoHandler.name = 'menuauto'
menuAutoHandler.aliases = ['comandosauto', 'auto']
menuAutoHandler.categoria = 'auto'
menuAutoHandler.subcategoria = 'AUTOMAÇÃO'
menuAutoHandler.descricao = 'Mostra os comandos e o estado da automação do grupo'
menuAutoHandler.uso = `${config.prefix}menuauto`

module.exports = menuAutoHandler
