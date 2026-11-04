const fs = require('fs')
const path = require('path')
const config = require('../../data/config.json')
const { getPrefixForChat } = require('../utils/configManager')
const { getSender, isOwnerCheck, isAdmin } = require('../utils/baileys')
const { obterVinculo } = require('../auto/vinculo')
const { montarSecaoAuto } = require('../auto/menuAuto')

const NORMAL = [
    {
        title: '🛒 PACOTES & VALORES',
        items: [['informacoes'], ['pagamento'], ['tabela'], ['tabelasaldo']]
    },
    {
        title: '📋 FERRAMENTAS & PERFIL',
        items: [['infogp'], ['perfil'], ['rank']]
    },
    {
        title: '👑 ATENDIMENTO & SUPORTE',
        items: [['aluguel'], ['dono'], ['suporte']]
    }
]

const ADMIN = [
    {
        title: '📊 PAINEL & PLANOS',
        items: [['configurar', 'listar'], ['configurar', 'saldo'], ['configurar', 'tabela'], ['configurar', 'ver saldo'], ['configurar', 'ver tabela']]
    },
    {
        title: '📦 CONTROLE DE VENDAS',
        items: [['aumentarlimite'], ['compras'], ['limparcompras'], ['recuperarcompras'], ['rank', '[on/off/me]'], ['primeirobonus', '[on/off/status]']]
    },
    {
        title: '🛡️ PROTEÇÃO DO GRUPO',
        items: [['antiaudio', '[on/off]'], ['antibot', '[on/off]'], ['antidoc', '[on/off]'], ['antiflood', '[on/off]'], ['antifoto', '[on/off]'], ['antigringo', '[on/off]'], ['antilink', '[on/off]'], ['antimidia', '[on/off]'], ['antipalavrao', '[on/off]'], ['antivideo', '[on/off]'], ['concorrentes', '[on/off]'], ['copiarprotecoes']]
    },
    {
        title: '👥 ADMINISTRAÇÃO DO GRUPO',
        items: [['aviso', '[texto]'], ['ban', '@membro'], ['bemvindo', '[on/off]'], ['grupo', '[abrir/fechar]'], ['infogp'], ['limpar'], ['linkgp'], ['mute', '[minutos]'], ['prefixo', '[novo]'], ['todos', '[texto]'], ['unmute'], ['x9', '[on/off]']]
    },
    {
        title: '🔑 LICENÇA & AJUSTES',
        items: [['ativarlicenca', '[chave]'], ['bot', '[on/off]'], ['ping'], ['renovar']]
    }
]

const DONO = [
    {
        title: '👑 ADMINISTRAÇÃO GLOBAL',
        items: [['off'], ['offall'], ['on'], ['onall'], ['prefixoglobal'], ['subdono', '[add/remove]']]
    },
    {
        title: '🔌 GRUPOS & PLANOS',
        items: [['aluguel'], ['bcast'], ['delgrupo'], ['entrar'], ['grupoall'], ['grupos'], ['remover', 'aluguel'], ['renovar'], ['sair']]
    },
    {
        title: '🔑 LICENÇAS',
        items: [['diminuirlicenca', 'grupo [dias]'], ['gerarlicenca', '[dias]'], ['renovar']]
    }
]

function montarMenu(prefix, categorias) {
    const vistos = new Set()
    const blocos = []

    for (const categoria of categorias) {
        const linhas = []
        for (const item of categoria.items) {
            const comando = item.join(' ')
            if (vistos.has(comando)) continue
            vistos.add(comando)
            linhas.push(`▸ ${prefix}${comando}`)
        }
        if (linhas.length === 0) continue
        blocos.push([
            `*${categoria.title}*`,
            '',
            ...linhas,
            '──────────────────'
        ].join('\n'))
    }

    return blocos.join('\n\n')
}

module.exports = async (sock, msg, from) => {
    const prefix = getPrefixForChat(from)
    const sender = getSender(msg)
    const isDono = isOwnerCheck(sender, msg)
    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}
    const botName = (config.botName || 'BOT').toUpperCase()
    const userName = msg.pushName || (isDono ? config.ownerName || 'Dono' : 'Usuário')

    const categorias = isDono
        ? [...DONO, ...ADMIN, ...NORMAL]
        : [...ADMIN, ...NORMAL]

    const header = [
        `⚡ *${botName}*`,
        `Boas-vindas, ${userName}!`,
        `Seu acesso: *${isDono ? 'DONO' : isAdm ? 'ADMIN' : 'MEMBRO'}*`,
        '──────────────────'
    ].join('\n')

    const secaoAuto = montarSecaoAuto(prefix, {
        isDono,
        isAdmin: isAdm,
        vinculo: obterVinculo(from)
    })

    const menuText = `${header}\n\n${montarMenu(prefix, categorias)}\n\n${secaoAuto}`
    const logoPath = path.join(__dirname, '../../assets', 'menuadm.jpg')

    if (fs.existsSync(logoPath)) {
        await sock.sendMessage(from, {
            image: fs.readFileSync(logoPath),
            caption: menuText
        }, { quoted: msg })
    } else {
        await sock.sendMessage(from, { text: menuText }, { quoted: msg })
    }
    return true
}
