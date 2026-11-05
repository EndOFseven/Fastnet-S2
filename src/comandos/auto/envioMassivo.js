const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { obterVinculo } = require('../../auto/vinculo')
const { iniciarLote } = require('../../auto/envioMassivo')

function ajudaTexto(prefix) {
    return [
        '📡 *ENVIO MASSIVO*',
        '',
        `▸ ${prefix}envio massivo`,
        '848346418 10gb',
        '845123456 30gb',
        '',
        'Ou responda a uma mensagem que contenha a lista.',
        '',
        `▸ ${prefix}envio massivo 848346418 10gb`,
        '',
        '_A lista é validada contra a tabela do grupo antes de qualquer envio._',
        '──────────────────'
    ].join('\n')
}

function obterConteudo(msg) {
    return msg.message?.viewOnceMessageV2?.message ||
        msg.message?.ephemeralMessage?.message ||
        msg.message ||
        {}
}

function obterTextoBruto(msg) {
    const conteudo = obterConteudo(msg)
    return conteudo.conversation ||
        conteudo.extendedTextMessage?.text ||
        conteudo.imageMessage?.caption ||
        conteudo.videoMessage?.caption ||
        ''
}

function obterTextoCitado(msg) {
    const conteudo = obterConteudo(msg)
    const contexto = conteudo.extendedTextMessage?.contextInfo ||
        conteudo.imageMessage?.contextInfo ||
        conteudo.videoMessage?.contextInfo
    const citado = contexto?.quotedMessage
    if (!citado) return ''
    return citado.conversation ||
        citado.extendedTextMessage?.text ||
        citado.imageMessage?.caption ||
        citado.videoMessage?.caption ||
        ''
}

function extrairCorpoLista(raw) {
    const linhas = String(raw || '').split(/\r?\n/)
    const primeira = linhas.shift() || ''
    const match = primeira.match(/(?:envio\s*massivo|enviomassivo|massivo)/i)
    let corpo = match ? primeira.slice(match.index + match[0].length).trim() : ''
    const resto = linhas.join('\n').trim()
    if (resto) corpo = [corpo, resto].filter(Boolean).join('\n')
    return corpo.trim()
}

async function envioMassivoHandler(sock, msg, from, sender, text) {
    const prefix = config.prefix || '.'
    const texto = String(text || '').trim()
    const semPrefixo = texto.startsWith(prefix) ? texto.slice(prefix.length).trimStart() : texto
    const primeiraLinha = semPrefixo.split(/\r?\n/)[0].trim()
    if (!/^(?:envio\s*massivo|enviomassivo|massivo)\b/i.test(primeiraLinha)) return false

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Esse comando só funciona em grupos.' }, { quoted: msg })
        return true
    }

    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}
    if (!isOwnerCheck(sender, msg) && !isAdm) {
        await sock.sendMessage(from, { text: '❌ Só administradores do grupo ou o Dono do bot podem usar o envio massivo.' }, { quoted: msg })
        return true
    }

    const vinculo = obterVinculo(from)
    if (!vinculo.centralCode || !vinculo.autoAtivo) {
        await sock.sendMessage(from, {
            text: [
                '❌ *Este grupo ainda não tem servidor conectado.*',
                '',
                `🔌 Use *${prefix}vincular <codigo>* para inserir o código do app.`,
                `📖 Passo a passo em *${prefix}menuauto*.`
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    let corpo = extrairCorpoLista(obterTextoBruto(msg))
    if (!corpo) corpo = obterTextoCitado(msg).trim()
    if (!corpo) {
        await sock.sendMessage(from, { text: ajudaTexto(prefix) }, { quoted: msg })
        return true
    }

    const resultado = await iniciarLote({
        sock,
        from,
        sender,
        texto: corpo,
        centralCode: vinculo.centralCode
    })

    if (!resultado.ok) {
        await sock.sendMessage(from, {
            text: [
                '❌ *ENVIO MASSIVO NÃO INICIADO*',
                '',
                resultado.erro || resultado.motivo || 'Não foi possível iniciar o lote.'
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    try { await sock.sendMessage(from, { react: { text: '📡', key: msg.key } }) } catch {}
    return true
}

envioMassivoHandler.nome = 'enviomassivo'
envioMassivoHandler.name = 'enviomassivo'
envioMassivoHandler.aliases = ['envio massivo', 'massivo']
envioMassivoHandler.categoria = 'auto'
envioMassivoHandler.subcategoria = 'AUTOMAÇÃO'
envioMassivoHandler.descricao = 'Envia vários pacotes para vários números numa só lista'
envioMassivoHandler.uso = `${config.prefix}envio massivo\n<numero> <pacote>`
envioMassivoHandler.apenasAdmin = true

module.exports = envioMassivoHandler
