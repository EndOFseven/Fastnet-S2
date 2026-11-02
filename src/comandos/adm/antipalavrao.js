const config = require('../../../data/config.json')
const fs = require('fs')
const path = require('path')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys')

const configPath = path.join(__dirname, '../../../data/groupConfig.json')
const avisosPath = path.join(__dirname, '../../../avisos.json')
const configManager = require('../../utils/configManager')

const defaultPalavroes = ['vsfr', 'vai a merda', 'caralho', 'mrd', 'fds', 'fodese', 'foda-se', 'filho da puta', 'puta', 'merda', 'fdp', 'crlh', 'pqp', 'cona', 'vai a merda vc']

function loadConfig() {
    return configManager.loadGroupConfig()
}

function saveConfig() {
    configManager.saveGroupConfig(true)
}

function obterPalavras(cfg, from) {
    if (!cfg[from]) cfg[from] = {}
    if (cfg[from].palavrasProibidas === undefined) {
        cfg[from].palavrasProibidas = [...defaultPalavroes]
        saveConfig(cfg)
    }
    return cfg[from].palavrasProibidas
}

const { avisosStore } = require('../../utils/firebaseDataLayer')

function loadAvisos() {
    return avisosStore.loadSync() || {}
}

function saveAvisos(data) {
    avisosStore.save(data)
}

module.exports = async (sock, msg, from, sender, text) => {
    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''

    const isOwner = isOwnerCheck(sender, msg)

    let adminStatus = isOwner
    if (!isOwner) {
        adminStatus = await checkIsAdmin(sock, from, sender)
    }

    const isAdminUser = adminStatus

    if (text === config.prefix + 'antipalavrao') {
        const cfg = loadConfig()
        const grupoConfig = cfg[from] || {}
        const status = grupoConfig.antipalavrao ? '✅ Ligado' : '❌ Desligado'
        const palavras = obterPalavras(cfg, from)

        await sock.sendMessage(from, {
            text: `⚙️ *ANTI-PALAVRÃO*\n──────────────────\n▸ Situação: ${status}\n▸ Palavras proibidas: ${palavras.length}\n──────────────────\n▸ *Comandos:*\n▸ .antipalavrao on/off\n▸ .antipalavrao dd <palavra>\n▸ .antipalavrao del <palavra>\n▸ .antipalavrao list\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antipalavrao on') {
        if (!isAdminUser) {
            await sock.sendMessage(from, { text: '❌ Exclusivo para admins.' }, { quoted: msg })
            return true
        }

        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].antipalavrao = true
        saveConfig(cfg)

        await sock.sendMessage(from, { text: '✅ *ANTI-PALAVRÃO LIGADO*\n──────────────────\n▸ ⚠️ Confirme que o bot é admin do grupo para poder apagar mensagens e remover usuários\n──────────────────' }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antipalavrao off' || text === config.prefix + 'antipalavrao of') {
        if (!isAdminUser) {
            await sock.sendMessage(from, { text: '❌ Exclusivo para admins.' }, { quoted: msg })
            return true
        }

        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].antipalavrao = false
        saveConfig(cfg)

        await sock.sendMessage(from, { text: '❌ *ANTI-PALAVRÃO DESLIGADO*\n──────────────────\n▸ Filtro de palavras desativado neste grupo' }, { quoted: msg })
        return true
    }

    if (text.startsWith(config.prefix + 'antipalavrao dd ')) {
        if (!isAdminUser) {
            await sock.sendMessage(from, { text: '❌ Exclusivo para admins.' }, { quoted: msg })
            return true
        }

        const palavra = body.slice((config.prefix + 'antipalavrao dd ').length).trim().toLowerCase()
        if (!palavra) {
            await sock.sendMessage(from, { text: '❌ Digite a palavra!\n\nEx: .antipalavrao dd puta' }, { quoted: msg })
            return true
        }

        const cfg = loadConfig()
        const palavras = obterPalavras(cfg, from)

        if (palavras.includes(palavra)) {
            await sock.sendMessage(from, { text: `⚠️ *PALAVRA JÁ CADASTRADA*\n──────────────────\n▸ "${palavra}" já consta na lista` }, { quoted: msg })
            return true
        }

        cfg[from].palavrasProibidas.push(palavra)
        saveConfig(cfg)

        await sock.sendMessage(from, { text: `✅ *PALAVRA BLOQUEADA*\n──────────────────\n▸ Palavra: "${palavra}"` }, { quoted: msg })
        return true
    }

    if (text.startsWith(config.prefix + 'antipalavrao del ')) {
        if (!isAdminUser) {
            await sock.sendMessage(from, { text: '❌ Exclusivo para admins.' }, { quoted: msg })
            return true
        }

        const palavra = body.slice((config.prefix + 'antipalavrao del ').length).trim().toLowerCase()

        const cfg = loadConfig()
        if (!cfg[from]?.palavrasProibidas?.includes(palavra)) {
            await sock.sendMessage(from, { text: `❌ "${palavra}" não consta na lista.` }, { quoted: msg })
            return true
        }

        cfg[from].palavrasProibidas = cfg[from].palavrasProibidas.filter(p => p !== palavra)
        saveConfig(cfg)

        await sock.sendMessage(from, { text: `🗑️ *PALAVRA REMOVIDA*\n──────────────────\n▸ Palavra: "${palavra}"` }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antipalavrao list') {
        const cfg = loadConfig()
        const palavras = obterPalavras(cfg, from)

        if (palavras.length === 0) {
            await sock.sendMessage(from, { text: '📋 *PALAVRAS PROIBIDAS*\n──────────────────\n▸ _Nenhuma palavra cadastrada_' }, { quoted: msg })
            return true
        }

        let lista = '📋 *PALAVRAS PROIBIDAS*\n──────────────────\n'
        palavras.forEach((p, i) => {
            lista += `▸ ${i + 1}. ${p}\n`
        })
        lista += '──────────────────'

        await sock.sendMessage(from, { text: lista }, { quoted: msg })
        return true
    }

    if (text.startsWith(config.prefix + 'antipalavrao reset')) {
        if (!isAdminUser) {
            await sock.sendMessage(from, { text: '❌ Exclusivo para admins.' }, { quoted: msg })
            return true
        }

        const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        if (mentions.length === 0) {
            await sock.sendMessage(from, { text: '❌ Marque o usuário!\n\nEx: .antipalavrao reset @user' }, { quoted: msg })
            return true
        }

        const avisos = loadAvisos()
        for (const mention of mentions) {
            if (avisos[from]?.[mention]) {
                avisos[from][mention] = 0
            }
        }
        saveAvisos(avisos)

        await sock.sendMessage(from, { text: '✅ *AVISOS ZERADOS*\n──────────────────\n▸ Avisos zerados para o(s) usuário(s) marcado(s)' }, { quoted: msg })
        return true
    }

    if (from.endsWith('@g.us') && !text.startsWith(config.prefix)) {
        const cfg = loadConfig()
        if (!cfg[from]?.antipalavrao) return false

        const palavras = obterPalavras(cfg, from)
        if (palavras.length === 0) return false

        const mensagem = body.toLowerCase()
        const palavraEncontrada = palavras.find(p => mensagem.includes(p))

        if (palavraEncontrada && !isAdminUser) {
            const numero = sender.split('@')[0]

            let apagou = false
            try {
                await sock.sendMessage(from, { delete: msg.key })
                apagou = true
            } catch (err) {
                console.error('[ANTIPALAVRAO] Erro ao apagar:', err.message)
            }

            const avisos = loadAvisos()
            if (!avisos[from]) avisos[from] = {}
            if (!avisos[from][sender]) avisos[from][sender] = 0

            avisos[from][sender]++
            const numAviso = avisos[from][sender]
            saveAvisos(avisos)

            if (numAviso >= 3) {
                try {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove')
                    await sock.sendMessage(from, {
                        text: `🚫 *MEMBRO REMOVIDO*\n──────────────────\n▸ @${numero} repetiu palavrões (3 avisos)\n──────────────────`,
                        mentions: [sender]
                    })

                    avisos[from][sender] = 0
                    saveAvisos(avisos)
                } catch (err) {
                    console.error('[ANTIPALAVRAO] Erro ao remover:', err.message)
                    await sock.sendMessage(from, {
                        text: `⚠️ *FALHA AO REMOVER*\n──────────────────\n▸ Não foi possível remover @${numero}\n▸ Confirme se o bot é admin do grupo`,
                        mentions: [sender]
                    })
                }
            } else {
                let proximoAviso = ''
                if (numAviso === 1) proximoAviso = 'Próximo = ⚠️ Segundo aviso'
                else if (numAviso === 2) proximoAviso = 'Próximo = 🚨 REMOÇÃO!'

                let msgTexto = `⚠️ *${numAviso}º AVISO*\n──────────────────\n▸ Usuário: @${numero}\n▸ Palavrão detectado${apagou ? '' : '\n▸ ⚠️ Não foi possível apagar a mensagem (bot não é admin?)'}\n──────────────────${proximoAviso ? `\n▸ ${proximoAviso}\n──────────────────` : ''}`

                await sock.sendMessage(from, {
                    text: msgTexto,
                    mentions: [sender]
                })
            }

            return true
        }
    }

    return false
}
