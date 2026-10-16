const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

// --- 1. SERVIDOR HTTP ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot de Fútbol activo 24/7'));
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));

// --- 2. CONFIGURACIÓN DE CLIENTE Y PUPPETEER ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// ESTRUCTURA DE DATOS
let partido = {
    activo: false,
    tipo: '',
    precio: '',
    lugar: '',
    linkUbicacion: '',
    fechaHora: '',
    maxJugadores: 0,
    jugadores: [],
    listaEspera: []
};

// FUNCIÓN AUXILIAR PARA GENERAR LA LISTA VISUAL
function generarTextoLista() {
    let texto = '⚽ *INFORMACIÓN DEL EVENTO Y CONVOCATORIA* ⚽\n\n';
    texto += '📌 *Tipo:* ' + partido.tipo + '\n';
    texto += '📍 *Lugar:* ' + partido.lugar + '\n';
    texto += '🗺️ *Ubicación:* ' + partido.linkUbicacion + '\n';
    texto += '📅 *Fecha y Hora:* ' + partido.fechaHora + '\n';
    texto += '💰 *Precio:* ' + partido.precio + ' (💳 *Pago previo por BIZUM*)\n\n';

    texto += '👥 *TITULARES (' + partido.jugadores.length + '/' + partido.maxJugadores + '):*\n';

    for (let i = 0; i < partido.maxJugadores; i++) {
        if (i < partido.jugadores.length) {
            texto += (i + 1) + '. ' + partido.jugadores[i] + ' ✅\n';
        } else {
            texto += (i + 1) + '. \n';
        }
    }

    if (partido.listaEspera.length > 0) {
        texto += '\n⏳ *LISTA DE ESPERA (' + partido.listaEspera.length + '):\n';
        partido.listaEspera.forEach((j, index) => {
            texto += (index + 1) + '. ' + j + '\n';
        });
    }

    return texto;
}

// FUNCIÓN AUXILIAR PARA ENVIAR Y FIJAR EL MENSAJE EN EL GRUPO
async function responderYFijar(msg, texto) {
    const respuestaEnviada = await msg.reply(texto);
    try {
        // Intenta fijar el mensaje recién enviado en el chat/grupo
        if (respuestaEnviada && typeof respuestaEnviada.pin === 'function') {
            await respuestaEnviada.pin(86400 * 7); // Fijar por 7 días
        } else {
            const chat = await msg.getChat();
            if (chat && typeof chat.pinWithMessage === 'function') {
                await chat.pinWithMessage(respuestaEnviada);
            }
        }
    } catch (pinError) {
        console.log('Nota: No se pudo fijar el mensaje automáticamente (asegúrate de que el bot sea Administrador del grupo):', pinError.message);
    }
}

// --- 3. EVENTOS DE CONEXIÓN ---
client.on('qr', (qr) => {
    console.log('--- ESCANEA ESTE CÓDIGO QR EN TU WHATSAPP ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('==============================================');
    console.log(' ¡EL BOT DE FÚTBOL ESTÁ CONECTADO Y LISTO! ');
    console.log('==============================================');
});

// --- 4. PROCESAMIENTO DE COMANDOS ---
const procesarMensaje = async (msg) => {
    try {
        const texto = msg.body ? msg.body.trim() : '';
        if (!texto.startsWith('!')) return;

        // 1. CREAR PARTIDO
        if (texto.startsWith('!crear')) {
            const parametros = texto.replace('!crear', '').split('|').map(item => item.trim());

            if (parametros.length < 5) {
                return await msg.reply(
                    '❌ *Formato incorrecto.* Usa:\n' +
                    '`!crear Tipo | Precio | Lugar | Link Ubicación | Fecha y Hora`\n\n' +
                    '*Ejemplo:*\n`!crear Fut 7 | 5€ | Campo Central | https://maps.google.com | Sábado 17:00`'
                );
            }

            const [tipo, precio, lugar, linkUbicacion, fechaHora] = parametros;

            let maxJugadores = 14;
            const tipoLower = tipo.toLowerCase();
            if (tipoLower.includes('8')) maxJugadores = 16;
            if (tipoLower.includes('11')) maxJugadores = 22;
            if (tipoLower.includes('5') || tipoLower.includes('sala')) maxJugadores = 10;

            partido = {
                activo: true,
                tipo,
                precio,
                lugar,
                linkUbicacion,
                fechaHora,
                maxJugadores,
                jugadores: [],
                listaEspera: []
            };

            const msjCrear = '🎉 *¡PARTIDO CREADO CON ÉXITO!*\n\n' + generarTextoLista() + '\nEscribe *!anotame* para inscribirte.';
            return await responderYFijar(msg, msjCrear);
        }

        // 2. ANOTARSE
        if (texto === '!anotame') {
            if (!partido.activo) return await msg.reply('⚠️ No hay ningún partido programado en este momento.');

            const nombre = msg._data?.notifyName || msg.author || 'Jugador';

            if (partido.jugadores.includes(nombre) || partido.listaEspera.includes(nombre)) {
                return await msg.reply('⚠️ Ya estás anotado en la lista.');
            }

            if (partido.jugadores.length < partido.maxJugadores) {
                partido.jugadores.push(nombre);
                await responderYFijar(msg, '✅ ¡Anotado/a ' + nombre + '!\n\n' + generarTextoLista());
            } else {
                partido.listaEspera.push(nombre);
                await responderYFijar(msg, '📋 El cupo principal está lleno. Te hemos añadido a la *Lista de Espera* (Puesto #' + partido.listaEspera.length + ').\n\n' + generarTextoLista());
            }
        }

        // 3. BAJARSE
        if (texto === '!bajame') {
            if (!partido.activo) return await msg.reply('⚠️ No hay ningún partido programado.');

            const nombre = msg._data?.notifyName || msg.author || 'Jugador';

            const idxJugador = partido.jugadores.indexOf(nombre);
            const idxEspera = partido.listaEspera.indexOf(nombre);

            if (idxJugador !== -1) {
                partido.jugadores.splice(idxJugador, 1);
                let msj = '🔴 Te has dado de baja de la lista principal.';

                if (partido.listaEspera.length > 0) {
                    const promocionado = partido.listaEspera.shift();
                    partido.jugadores.push(promocionado);
                    msj += '\n🎉 ¡Atención ' + promocionado + '! Subiste automáticamente a la lista principal.';
                }
                await responderYFijar(msg, msj + '\n\n' + generarTextoLista());
            } else if (idxEspera !== -1) {
                partido.listaEspera.splice(idxEspera, 1);
                await responderYFijar(msg, '🔴 Te has dado de baja de la lista de espera.\n\n' + generarTextoLista());
            } else {
                await msg.reply('⚠️ No estabas registrado en la lista.');
            }
        }

        // 4. VER LISTA
        if (texto === '!lista') {
            if (!partido.activo) return await msg.reply('⚠️ No hay ningún partido activo actualmente.');
            await msg.reply(generarTextoLista());
        }

        // 5. SORTEO
        if (texto === '!sorteo') {
            if (!partido.activo || partido.jugadores.length < 2) {
                return await msg.reply('⚠️ Necesitas al menos 2 jugadores confirmados en la lista para realizar el sorteo.');
            }

            const copiaJugadores = [...partido.jugadores];
            const capitan1 = copiaJugadores.splice(Math.floor(Math.random() * copiaJugadores.length), 1)[0];
            const capitan2 = copiaJugadores.splice(Math.floor(Math.random() * copiaJugadores.length), 1)[0];

            const colorCap1 = Math.random() < 0.5 ? '⚪ BLANCO' : '⚫ NEGRO';
            const colorCap2 = colorCap1.includes('BLANCO') ? '⚫ NEGRO' : '⚪ BLANCO';

            const msjSorteo = 
                '🎲 *RESULTADO DEL SORTEO DE CAPITANES* 🎲\n\n' +
                '👑 *Capitán 1:* ' + capitan1 + ' -> Camiseta ' + colorCap1 + '\n' +
                '👑 *Capitán 2:* ' + capitan2 + ' -> Camiseta ' + colorCap2 + '\n\n' +
                '¡A elegir equipos! ⚽';

            await msg.reply(msjSorteo);
        }
    } catch (err) {
        console.error('Error procesando el mensaje:', err);
    }
};

client.on('message', procesarMensaje);
client.on('message_create', async (msg) => {
    if (msg.fromMe) await procesarMensaje(msg);
});

client.initialize();