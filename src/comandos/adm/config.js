const path = require('path')
const fs = require('fs')
const config = require(path.join(__dirname, '../../../data/config.json'))

const configManager = require('../../utils/configManager')

function loadGroupConfig() {
    return configManager.loadGroupConfig()
}

function saveGroupConfig() {
    configManager.saveGroupConfig(true)
}

const { isAdmin: checkIsAdmin, isOwnerCheck, addSubdono } = require('../../utils/baileys')

module.exports = async (sock, msg, from, sender, text) => {

    const isOwner = isOwnerCheck(sender, msg)

    let adminStatus = isOwner
    if (!isOwner) {
        adminStatus = await checkIsAdmin(sock, from, sender)
    }

    const isAdmin = adminStatus

    if (text.startsWith(config.prefix + 'config subdono')) {
        if (!isOwner) {
            await sock.sendMessage(from, { text: '❌ Só o dono principal define o subdono.' }, { quoted: msg })
            return true
        }
        const args = text.split(' ')
        const numero = args[2] || ''
        const numClean = numero.replace(/\D/g, '')

        if (!numClean) {
            await sock.sendMessage(from, { text: `❌ *COMANDO INCORRETO*\n──────────────────\n▸ Formato correto: \`.config subdono 258xxx\`` }, { quoted: msg })
            return true
        }

        addSubdono(numClean)

        await sock.sendMessage(from, { text: `✅ *SUBDONO DEFINIDO*\n──────────────────\n▸ Número: ${numClean}` }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antilink') {
        const groups = loadGroupConfig()
        const status = groups[from]?.antilink ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        await sock.sendMessage(from, { text: `🔗 *ANTILINK*\n──────────────────\n▸ Status: ${status}\n──────────────────\n_Para mudar:_\n▸ \`.antilink on\`\n▸ \`.antilink off\`` }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antilink on') {
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Só administradores podem usar isto.' }, { quoted: msg })
            return true
        }
        const groups = loadGroupConfig()
        if (!groups[from]) groups[from] = {}

        if (groups[from].antilink) {
            await sock.sendMessage(from, { text: '⚠️ *AVISO*\n──────────────────\n▸ O *Antilink* já está ligado neste grupo!' }, { quoted: msg })
            return true
        }

        groups[from].antilink = true
        saveGroupConfig(groups)
        await sock.sendMessage(from, {
            text: '🔗 *ANTILINK LIGADO*\n──────────────────\n▸ Links serão detectados e o autor removido.'
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antilink off' || text === config.prefix + 'antilink of') {
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Só administradores podem usar isto.' }, { quoted: msg })
            return true
        }
        const groups = loadGroupConfig()
        if (!groups[from]) groups[from] = {}

        if (groups[from].antilink === false) {
            await sock.sendMessage(from, { text: '⚠️ *AVISO*\n──────────────────\n▸ O *Antilink* já está desligado!' }, { quoted: msg })
            return true
        }

        groups[from].antilink = false
        saveGroupConfig(groups)
        await sock.sendMessage(from, {
            text: '🔗 *ANTILINK DESLIGADO*\n──────────────────\n▸ A proteção contra links foi desativada.'
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'detectarimg') {
        const groups = loadGroupConfig()
        const status = groups[from]?.detectarImg ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        await sock.sendMessage(from, { text: `🖼️ *DETECÇÃO OCR*\n──────────────────\n▸ Status: ${status}\n──────────────────\n_Para mudar:_\n▸ \`.detectarimg on\`\n▸ \`.detectarimg off\`` }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'detectarimg on') {
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Só administradores podem usar isto.' }, { quoted: msg })
            return true
        }
        const groups = loadGroupConfig()
        if (!groups[from]) groups[from] = {}

        if (groups[from].detectarImg) {
            await sock.sendMessage(from, { text: '⚠️ *AVISO*\n──────────────────\n▸ A *Detecção de Imagem* já está ligada!' }, { quoted: msg })
            return true
        }

        groups[from].detectarImg = true
        saveGroupConfig(groups)
        await sock.sendMessage(from, {
            text: '🖼️ *DETECÇÃO DE IMAGEM LIGADA*\n──────────────────\n▸ Comprovativos em imagem serão lidos.'
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'detectarimg off') {
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Só administradores podem usar isto.' }, { quoted: msg })
            return true
        }
        const groups = loadGroupConfig()
        if (!groups[from]) groups[from] = {}

        if (groups[from].detectarImg === false) {
            await sock.sendMessage(from, { text: '⚠️ *AVISO*\n──────────────────\n▸ A *Detecção de Imagem* já está desligada!' }, { quoted: msg })
            return true
        }

        groups[from].detectarImg = false
        saveGroupConfig(groups)
        await sock.sendMessage(from, {
            text: '🖼️ *DETECÇÃO DE IMAGEM DESLIGADA*\n──────────────────\n▸ Comprovativos em imagem não serão mais lidos.'
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'boas-vindas' || text === config.prefix + 'boasvindas') {
        const groups = loadGroupConfig()
        const status = groups[from]?.bemvindo ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        await sock.sendMessage(from, { text: `👋 *BOAS-VINDAS*\n──────────────────\n▸ Status: ${status}\n──────────────────\n_Para mudar:_\n▸ \`.boas-vindas on\`\n▸ \`.boas-vindas off\`` }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'boas-vindas on') {
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Só administradores podem usar isto.' }, { quoted: msg })
            return true
        }
        const groups = loadGroupConfig()
        if (!groups[from]) groups[from] = {}

        if (groups[from].bemvindo) {
            await sock.sendMessage(from, { text: '⚠️ *AVISO*\n──────────────────\n▸ O *Boas-Vindas* já está ligado!' }, { quoted: msg })
            return true
        }

        groups[from].bemvindo = true
        saveGroupConfig(groups)
        await sock.sendMessage(from, {
            text: '👋 *BOAS-VINDAS LIGADO*\n──────────────────\n▸ Novos membros recebem a mensagem de entrada.'
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'boas-vindas off') {
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Só administradores podem usar isto.' }, { quoted: msg })
            return true
        }
        const groups = loadGroupConfig()
        if (!groups[from]) groups[from] = {}

        if (groups[from].bemvindo === false) {
            await sock.sendMessage(from, { text: '⚠️ *AVISO*\n──────────────────\n▸ O *Boas-Vindas* já está desligado!' }, { quoted: msg })
            return true
        }

        groups[from].bemvindo = false
        saveGroupConfig(groups)
        await sock.sendMessage(from, {
            text: '👋 *BOAS-VINDAS DESLIGADO*\n──────────────────\n▸ Novos membros não recebem mais a mensagem de entrada.'
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'adeus') {
        const groups = loadGroupConfig()
        const status = groups[from]?.adeus ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        await sock.sendMessage(from, { text: `👋 *NOTIFICAÇÃO DE SAÍDA*\n──────────────────\n▸ Status: ${status}\n──────────────────\n_Para mudar:_\n▸ \`.adeus on\`\n▸ \`.adeus off\`` }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'adeus on') {
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Só administradores podem usar isto.' }, { quoted: msg })
            return true
        }
        const groups = loadGroupConfig()
        if (!groups[from]) groups[from] = {}

        if (groups[from].adeus) {
            await sock.sendMessage(from, { text: '⚠️ *AVISO*\n──────────────────\n▸ A *Notificação de Saída* já está ligada!' }, { quoted: msg })
            return true
        }

        groups[from].adeus = true
        saveGroupConfig(groups)
        await sock.sendMessage(from, {
            text: '👋 *NOTIFICAÇÃO DE SAÍDA LIGADA*\n──────────────────\n▸ O bot avisa quando alguém sai ou é removido.'
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'adeus off') {
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Só administradores podem usar isto.' }, { quoted: msg })
            return true
        }
        const groups = loadGroupConfig()
        if (!groups[from]) groups[from] = {}

        if (groups[from].adeus === false) {
            await sock.sendMessage(from, { text: '⚠️ *AVISO*\n──────────────────\n▸ A *Notificação de Saída* já está desligada!' }, { quoted: msg })
            return true
        }

        groups[from].adeus = false
        saveGroupConfig(groups)
        await sock.sendMessage(from, {
            text: '👋 *NOTIFICAÇÃO DE SAÍDA DESLIGADA*\n──────────────────\n▸ O bot não avisa mais quando alguém sai ou é removido.'
        }, { quoted: msg })
        return true
    }

    return false
}
