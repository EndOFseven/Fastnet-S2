const config = require('../../../data/config.json')
const configManager = require('../../utils/configManager')
const { isAdmin, isOwnerCheck, isLeaderCheck, getGroupMetadataCached } = require('../../utils/baileys')

const LISTA_PAISES = [
    { prefix: '258', nome: '🇲🇿 Moçambique', ddi: '258', minLen: 9, maxLen: 12 },
    { prefix: '55',  nome: '🇧🇷 Brasil',      ddi: '55',  minLen: 12, maxLen: 13 },
    { prefix: '244', nome: '🇦🇴 Angola',      ddi: '244', minLen: 12, maxLen: 12 },
    { prefix: '351', nome: '🇵🇹 Portugal',    ddi: '351', minLen: 12, maxLen: 12 },
    { prefix: '1',   nome: '🇺🇸 EUA / Canadá', ddi: '1',   minLen: 11, maxLen: 11 },
    { prefix: '27',  nome: '🇿🇦 África do Sul', ddi: '27', minLen: 11, maxLen: 11 },
    { prefix: '234', nome: '🇳🇬 Nigéria',     ddi: '234', minLen: 13, maxLen: 14 },
    { prefix: '44',  nome: '🇬🇧 Reino Unido', ddi: '44',  minLen: 12, maxLen: 12 },
    { prefix: '91',  nome: '🇮🇳 Índia',       ddi: '91',  minLen: 12, maxLen: 12 },
    { prefix: '92',  nome: '🇵🇰 Paquistão',   ddi: '92',  minLen: 12, maxLen: 12 },
    { prefix: '263', nome: '🇿🇼 Zimbábue',   ddi: '263', minLen: 12, maxLen: 12 },
    { prefix: '260', nome: '🇿🇲 Zâmbia',      ddi: '260', minLen: 12, maxLen: 12 },
    { prefix: '255', nome: '🇹🇿 Tanzânia',    ddi: '255', minLen: 12, maxLen: 12 }
]

function identificarPaisPorNumero(numStr) {
    if (!numStr) return { ddi: '??', nome: 'Desconhecido', isMoz: false, isValido: false }
    const clean = String(numStr).replace(/\D/g, '')

    if (clean.length > 13 || clean.length < 9) {
        return { ddi: '??', nome: 'ID Inválido', isMoz: false, isValido: false }
    }

    if (clean.startsWith('258') && (clean.length === 11 || clean.length === 12)) {
        return { ddi: '258', nome: '🇲🇿 Moçambique', isMoz: true, isValido: true }
    }
    if (clean.length === 9 && /^[8][2-7]/.test(clean)) {
        return { ddi: '258', nome: '🇲🇿 Moçambique', isMoz: true, isValido: true }
    }

    for (const p of LISTA_PAISES) {
        if (p.prefix === '258') continue
        if (clean.startsWith(p.prefix) && clean.length >= p.minLen && clean.length <= p.maxLen) {
            return { ddi: p.ddi, nome: p.nome, isMoz: false, isValido: true }
        }
    }

    if (clean.length >= 10 && clean.length <= 13) {
        const ddiGen = clean.slice(0, 2)
        return { ddi: ddiGen, nome: `🌍 Estrangeiro (+${ddiGen})`, isMoz: false, isValido: true }
    }

    return { ddi: '??', nome: 'ID Inválido', isMoz: false, isValido: false }
}

function getNomePais(ddi) {
    const found = LISTA_PAISES.find(p => p.ddi === String(ddi).replace(/\D/g, ''))
    return found ? found.nome : `+${ddi}`
}

function extrairNumeroReal(participant) {
    if (!participant) return null

    if (typeof participant === 'string') {
        if (participant.endsWith('@s.whatsapp.net')) {
            const num = participant.split('@')[0].split(':')[0].replace(/\D/g, '')
            if (num && num.length >= 8 && num.length <= 13) return num
        }
        if (participant.includes('@lid')) {
            try {
                const { buscarNumero } = require('../../bot/core')
                const rawId = participant.split('@')[0].split(':')[0]
                const resolvido = buscarNumero(rawId)
                if (resolvido && resolvido !== rawId && !resolvido.includes('@lid')) {
                    const clean = String(resolvido).split('@')[0].split(':')[0].replace(/\D/g, '')
                    if (clean && clean.length >= 8 && clean.length <= 13) return clean
                }
            } catch {}
            return null
        }
        const clean = participant.split('@')[0].split(':')[0].replace(/\D/g, '')
        if (clean && clean.length >= 8 && clean.length <= 13) return clean
        return null
    }

    const id = participant.id || ''
    const pn = participant.pn || participant.phoneNumber || participant.phone || ''
    const lid = participant.lid || ''

    if (pn && typeof pn === 'string' && !pn.includes('@lid')) {
        const cleanPn = pn.split('@')[0].split(':')[0].replace(/\D/g, '')
        if (cleanPn && cleanPn.length >= 8 && cleanPn.length <= 13) return cleanPn
    }

    if (id && id.endsWith('@s.whatsapp.net')) {
        const num = id.split('@')[0].split(':')[0].replace(/\D/g, '')
        if (num && num.length >= 8 && num.length <= 13) return num
    }

    try {
        const { buscarNumero } = require('../../bot/core')
        const rawId = (id || lid || '').split('@')[0].split(':')[0]
        if (rawId) {
            const resolvido = buscarNumero(rawId)
            if (resolvido && resolvido !== rawId && !resolvido.includes('@lid')) {
                const clean = String(resolvido).split('@')[0].split(':')[0].replace(/\D/g, '')
                if (clean && clean.length >= 8 && clean.length <= 13) return clean
            }
        }
    } catch {}

    return null
}

module.exports = async function (sock, msg, from, sender, text) {
    const rawTokens = text.trim().split(/\s+/)
    const rawCmd = rawTokens[0].toLowerCase()
    const prefix = config.prefix

    const isAntigringoCmd = (
        rawCmd === prefix + 'antigringo' ||
        rawCmd === prefix + 'antiestrangeiro' ||
        rawCmd === prefix + 'antigringos' ||
        rawCmd === prefix + 'gringos' ||
        rawCmd === prefix + 'gringo' ||
        rawCmd === prefix + 'mapeargringos' ||
        rawCmd === prefix + 'mapgringos'
    )

    if (!isAntigringoCmd) return false

    const isGroup = from.endsWith('@g.us')
    if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ Comando exclusivo para grupos.' }, { quoted: msg })
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}

    if (!isOwner && !isAdm) {
        await sock.sendMessage(from, { text: '❌ Só administradores do grupo ou o Dono podem usar isto.' }, { quoted: msg })
        return true
    }

    const dotJid = from.replace(/\./g, '___dot___')
    const groupConfig = configManager.loadGroupConfig()
    if (!groupConfig[from]) groupConfig[from] = {}
    if (!groupConfig[dotJid]) groupConfig[dotJid] = groupConfig[from]

    const subCmd = (rawTokens[1] || '').toLowerCase()
    const isMapCmd = (
        rawCmd === prefix + 'gringos' && (rawTokens.length === 1 || subCmd === 'mapear' || subCmd === 'lista' || subCmd === 'check') ||
        rawCmd === prefix + 'mapeargringos' ||
        rawCmd === prefix + 'mapgringos' ||
        (rawCmd.includes('antigringo') && (subCmd === 'mapear' || subCmd === 'lista' || subCmd === 'check' || subCmd === 'ver'))
    )

    const isVarrerCmd = (
        subCmd === 'varrer' ||
        subCmd === 'banir' ||
        subCmd === 'limpar' ||
        (rawCmd === prefix + 'gringos' && subCmd === 'banir')
    )

    const allowedDdis = (groupConfig[from].ddisPermitidos || groupConfig[dotJid].ddisPermitidos || ['258'])

    if (subCmd === 'on' || subCmd === 'ligar' || subCmd === '1') {
        groupConfig[from].antigringo = true
        groupConfig[dotJid].antigringo = true
        if (!groupConfig[from].ddisPermitidos) groupConfig[from].ddisPermitidos = ['258']
        if (!groupConfig[dotJid].ddisPermitidos) groupConfig[dotJid].ddisPermitidos = ['258']
        configManager.saveGroupConfig(groupConfig, true)

        const ddiListStr = groupConfig[from].ddisPermitidos.map(d => getNomePais(d)).join(', ')

        await sock.sendMessage(from, {
            text: `🛡️ *ANTI-GRINGO LIGADO!*\n\n✅ Novos membros com número estrangeiro serão retirados assim que entrarem.\n\n📌 *Países Permitidos:* ${ddiListStr}\n💡 Quer ver quem já está no grupo? Digite: \`.gringos\`\n💡 Quer remover os estrangeiros atuais? Digite: \`.antigringo varrer\``
        }, { quoted: msg })
        return true
    }

    if (subCmd === 'off' || subCmd === 'desligar' || subCmd === '0') {
        groupConfig[from].antigringo = false
        groupConfig[dotJid].antigringo = false
        configManager.saveGroupConfig(groupConfig, true)

        await sock.sendMessage(from, {
            text: '❌ *Anti-Gringo desligado neste grupo.*'
        }, { quoted: msg })
        return true
    }

    if (subCmd === 'permitir' || subCmd === 'liberar' || subCmd === 'add') {
        const ddiInput = (rawTokens[2] || '').replace(/\D/g, '')
        if (!ddiInput) {
            await sock.sendMessage(from, {
                text: `❌ *Informe o DDI do país que quer permitir!*\n\n_Exemplos:_\n• \`${prefix}antigringo permitir 55\` (Brasil)\n• \`${prefix}antigringo permitir 244\` (Angola)\n• \`${prefix}antigringo permitir 351\` (Portugal)`
            }, { quoted: msg })
            return true
        }

        if (!groupConfig[from].ddisPermitidos) groupConfig[from].ddisPermitidos = ['258']
        if (!groupConfig[dotJid].ddisPermitidos) groupConfig[dotJid].ddisPermitidos = ['258']

        if (!groupConfig[from].ddisPermitidos.includes(ddiInput)) {
            groupConfig[from].ddisPermitidos.push(ddiInput)
            groupConfig[dotJid].ddisPermitidos.push(ddiInput)
            configManager.saveGroupConfig(groupConfig, true)
        }

        const paisNome = getNomePais(ddiInput)
        await sock.sendMessage(from, {
            text: `✅ *PAÍS LIBERADO!*\n\nNúmeros de *${paisNome}* (+${ddiInput}) passam a ser aceitos neste grupo e não serão removidos pelo Anti-Gringo.`
        }, { quoted: msg })
        return true
    }

    if (subCmd === 'reset' || subCmd === 'padrao' || subCmd === 'limparpaises') {
        groupConfig[from].ddisPermitidos = ['258']
        groupConfig[dotJid].ddisPermitidos = ['258']
        configManager.saveGroupConfig(groupConfig, true)

        await sock.sendMessage(from, {
            text: '🔄 *LISTA DE PAÍSES RESTAURADA!*\n\nAgora só são aceitos números de *🇲🇿 Moçambique* (+258). Qualquer outro país é tratado como estrangeiro (gringo).'
        }, { quoted: msg })
        return true
    }

    if (subCmd === 'proibir' || subCmd === 'bloquear' || subCmd === 'del') {
        const ddiInput = (rawTokens[2] || '').replace(/\D/g, '')
        if (!ddiInput) {
            await sock.sendMessage(from, {
                text: `❌ *Informe o DDI do país que quer bloquear!*\n\n_Exemplo: \`${prefix}antigringo proibir 55\``
            }, { quoted: msg })
            return true
        }

        if (ddiInput === '258') {
            await sock.sendMessage(from, {
                text: '❌ *Não é possível bloquear Moçambique (+258)!* Esse é o país padrão do bot.'
            }, { quoted: msg })
            return true
        }

        if (groupConfig[from].ddisPermitidos) {
            groupConfig[from].ddisPermitidos = groupConfig[from].ddisPermitidos.filter(d => d !== ddiInput)
        }
        if (groupConfig[dotJid].ddisPermitidos) {
            groupConfig[dotJid].ddisPermitidos = groupConfig[dotJid].ddisPermitidos.filter(d => d !== ddiInput)
        }
        configManager.saveGroupConfig(groupConfig, true)

        const paisNome = getNomePais(ddiInput)
        await sock.sendMessage(from, {
            text: `🔒 *PAÍS BLOQUEADO!*\n\nNúmeros de *${paisNome}* (+${ddiInput}) voltam a ser proibidos neste grupo.`
        }, { quoted: msg })
        return true
    }

    if (isMapCmd) {
        try { await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } }) } catch {}

        try {
            const { mapearGrupo } = require('../../bot/core')
            try { await mapearGrupo(sock, from) } catch {}

            const metadata = await sock.groupMetadata(from)
            const participants = metadata.participants || []

            const botJid = sock.user?.id || ''
            const botNumber = botJid.split(':')[0].split('@')[0].replace(/\D/g, '')
            const botLid = sock.user?.lid ? sock.user.lid.split(':')[0].split('@')[0].replace(/\D/g, '') : ''

            const admins = participants
                .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                .map(p => {
                    const pId = p.id || ''
                    const numReal = extrairNumeroReal(p)
                    return numReal || pId.split('@')[0].split(':')[0].replace(/\D/g, '')
                })

            const gringos = []

            for (const p of participants) {
                const pId = p.id || ''
                const pLid = p.lid || ''
                const numReal = extrairNumeroReal(p)

                if (!numReal) continue

                if (numReal === botNumber || numReal === botLid || (botNumber && pId.includes(botNumber)) || (botLid && pLid.includes(botLid))) {
                    continue
                }

                const infoPais = identificarPaisPorNumero(numReal)
                if (!infoPais.isValido) continue

                if (!infoPais.isMoz) {
                    const isAdmP = admins.includes(numReal) || (p.admin === 'admin' || p.admin === 'superadmin')
                    const isDonoP = isOwnerCheck(pId) || isLeaderCheck(pId) || isOwnerCheck(numReal) || isLeaderCheck(numReal)
                    const isPermitido = allowedDdis.includes(infoPais.ddi) || allowedDdis.some(d => numReal.startsWith(d))

                    gringos.push({
                        id: pId,
                        numero: numReal,
                        pais: infoPais.nome,
                        ddi: infoPais.ddi,
                        isAdmin: isAdmP,
                        isDono: isDonoP,
                        isPermitido: isPermitido
                    })
                }
            }

            if (gringos.length === 0) {
                try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
                await sock.sendMessage(from, {
                    text: [
                        '🌍 *MAPA DE NÚMEROS ESTRANGEIROS*',
                        '────────────────────────',
                        '✅ *Nenhum número estrangeiro encontrado!*',
                        '',
                        `Todos os membros identificados neste grupo têm números nacionais de Moçambique (+258).`
                    ].join('\n')
                }, { quoted: msg })
                return true
            }

            const linhas = [
                '🌍 *MAPA DE NÚMEROS ESTRANGEIROS (GRINGOS)*',
                '────────────────────────',
                `👥 *Grupo:* ${metadata.subject}`,
                `🚨 *Encontrados:* ${gringos.length} estrangeiro(s)`,
                `📌 *Países Autorizados:* ${allowedDdis.map(d => `${getNomePais(d)} (+${d})`).join(', ')}`,
                '',
                'Membros estrangeiros presentes no grupo:',
                ''
            ]

            const mentions = []
            gringos.forEach((g, idx) => {
                let statusTag = ''
                if (g.isAdmin) {
                    statusTag = ' 👑 *(Admin - Protegido)*'
                } else if (g.isDono) {
                    statusTag = ' 🛡️ *(Dono/Subdono)*'
                } else if (g.isPermitido) {
                    statusTag = ' 🟢 *(País liberado)*'
                } else {
                    statusTag = ' 🚨 *(Membro comum - pode ser banido)*'
                }

                linhas.push(`*${idx + 1}.* @${g.numero} • ${g.pais}${statusTag}`)
                mentions.push(`${g.numero}@s.whatsapp.net`)
                if (g.id && g.id.includes('@')) mentions.push(g.id)
            })

            linhas.push('')
            linhas.push('────────────────────────')
            linhas.push('💡 *Ações disponíveis:*')
            linhas.push(`👉 \`${prefix}antigringo varrer\` ➔ Remover membros comuns de países não liberados`)
            linhas.push(`👉 \`${prefix}antigringo permitir [DDI]\` ➔ Liberar país (Ex: \`${prefix}antigringo permitir 55\`)`)
            linhas.push(`👉 \`${prefix}antigringo proibir [DDI]\` ➔ Bloquear país (Ex: \`${prefix}antigringo proibir 55\`)`)

            try { await sock.sendMessage(from, { react: { text: '⚠️', key: msg.key } }) } catch {}

            await sock.sendMessage(from, {
                text: linhas.join('\n'),
                mentions
            }, { quoted: msg })

            return true

        } catch (err) {
            console.error('[GRINGOS-MAP] Erro ao mapear:', err)
            await sock.sendMessage(from, { text: `❌ *Não foi possível mapear os estrangeiros:* ${err.message}` }, { quoted: msg })
            return true
        }
    }

    if (isVarrerCmd) {
        try { await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } }) } catch {}

        try {
            const { mapearGrupo } = require('../../bot/core')
            try { await mapearGrupo(sock, from) } catch {}

            const metadata = await sock.groupMetadata(from)
            const participants = metadata.participants || []

            const botJid = sock.user?.id || ''
            const botNumber = botJid.split(':')[0].split('@')[0].replace(/\D/g, '')
            const botLid = sock.user?.lid ? sock.user.lid.split(':')[0].split('@')[0].replace(/\D/g, '') : ''

            const admins = participants
                .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                .map(p => {
                    const pId = p.id || ''
                    const numReal = extrairNumeroReal(p)
                    return numReal || pId.split('@')[0].split(':')[0].replace(/\D/g, '')
                })

            const gringosParaBanir = []

            for (const p of participants) {
                const pId = p.id || ''
                const pLid = p.lid || ''
                const numReal = extrairNumeroReal(p)

                if (!numReal) continue

                if (numReal === botNumber || numReal === botLid || (botNumber && pId.includes(botNumber)) || (botLid && pLid.includes(botLid))) {
                    continue
                }

                if (admins.includes(numReal) || p.admin === 'admin' || p.admin === 'superadmin' || isOwnerCheck(pId) || isLeaderCheck(pId) || isOwnerCheck(numReal) || isLeaderCheck(numReal)) {
                    continue
                }

                const infoPais = identificarPaisPorNumero(numReal)
                if (!infoPais.isValido) continue

                const isPermitido = infoPais.isMoz || allowedDdis.includes(infoPais.ddi) || allowedDdis.some(d => numReal.startsWith(d))

                if (!isPermitido) {
                    gringosParaBanir.push({
                        id: pId,
                        numero: numReal,
                        pais: infoPais.nome,
                        ddi: infoPais.ddi
                    })
                }
            }

            if (gringosParaBanir.length === 0) {
                try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
                await sock.sendMessage(from, {
                    text: [
                        '🛡️ *VARREDURA ANTI-GRINGO*',
                        '────────────────────────',
                        '✅ *Nenhum membro comum estrangeiro para remover!*',
                        '',
                        `Todos os membros comuns deste grupo têm números de países liberados (${allowedDdis.map(d => `+${d}`).join(', ')}).`
                    ].join('\n')
                }, { quoted: msg })
                return true
            }

            try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }) } catch {}

            const banidos = []
            const mentions = []

            for (const g of gringosParaBanir) {
                try {
                    await sock.groupParticipantsUpdate(from, [g.id], 'remove')
                    banidos.push(g)
                    mentions.push(g.id)
                } catch (err) {
                    try {
                        await sock.groupParticipantsUpdate(from, [`${g.numero}@s.whatsapp.net`], 'remove')
                        banidos.push(g)
                        mentions.push(`${g.numero}@s.whatsapp.net`)
                    } catch (err2) {
                        console.error(`[ANTIGRINGO] Erro ao remover ${g.numero}:`, err2.message)
                    }
                }
            }

            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}

            const relatorio = [
                '🛡️ *VARREDURA ANTI-GRINGO FINALIZADA!*',
                '────────────────────────',
                `🚫 *Removidos:* ${banidos.length} número(s) estrangeiro(s)`,
                ''
            ]

            banidos.forEach((b, idx) => {
                relatorio.push(`*${idx + 1}.* @${b.numero} • ${b.pais}`)
            })

            relatorio.push('')
            relatorio.push('🔒 O grupo ficou livre de contas estrangeiras não liberadas.')

            await sock.sendMessage(from, {
                text: relatorio.join('\n'),
                mentions
            }, { quoted: msg })

            return true

        } catch (err) {
            console.error('[ANTIGRINGO-VARREDURA] Erro:', err)
            await sock.sendMessage(from, { text: `❌ *Não foi possível varrer o grupo:* ${err.message}` }, { quoted: msg })
            return true
        }
    }

    const status = groupConfig[from]?.antigringo ? '🟢 *ATIVADO*' : '🔴 *DESATIVADO*'
    const ddisStr = allowedDdis.map(d => `${getNomePais(d)} (+${d})`).join('\n   └ ')

    await sock.sendMessage(from, {
        text: [
            '🛡️ *ANTI-GRINGO*',
            '────────────────────────',
            `📌 *Situação no Grupo:* ${status}`,
            `🌍 *Países Permitidos:*`,
            `   └ ${ddisStr}`,
            '',
            '📋 *Como gerenciar:*',
            `• \`${prefix}gringos\` ➔ Listar todos os números estrangeiros no grupo`,
            `• \`${prefix}antigringo varrer\` ➔ Remover os gringos do grupo`,
            `• \`${prefix}antigringo on\` ➔ Remover estrangeiros automaticamente ao entrar`,
            `• \`${prefix}antigringo off\` ➔ Desligar a proteção`,
            `• \`${prefix}antigringo permitir [DDI]\` ➔ Liberar um país (Ex: \`.antigringo permitir 55\`)`,
            `• \`${prefix}antigringo proibir [DDI]\` ➔ Bloquear um país (Ex: \`.antigringo proibir 55\`)`
        ].join('\n')
    }, { quoted: msg })

    return true
}
