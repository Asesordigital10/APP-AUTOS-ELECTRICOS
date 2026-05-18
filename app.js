import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, deleteDoc, orderBy, getDocs, where } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// --- 1. CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyA11UK2o8-EgE9vTTcw-eeA55yC-n9eZIg",
    authDomain: "app-autos-electricos-5a311.firebaseapp.com",
    projectId: "app-autos-electricos-5a311",
    storageBucket: "app-autos-electricos-5a311.firebasestorage.app",
    messagingSenderId: "877759630392",
    appId: "1:877759630392:web:eed9d7b0f1a99fd91c2acd"
};

// --- 2. CONFIGURACIÓN DE GEMINI ---
const GEMINI_PARTE_1 = "AIzaSyBHTsmqMGxc2T"; 
const GEMINI_PARTE_2 = "yG7sKIsu3mdScs1EmuQi8"; 
const GEMINI_KEY = GEMINI_PARTE_1 + GEMINI_PARTE_2;
const RECAPTCHA_SITE_KEY = "6LdE3OosAAAAALzMd8EpS2gkNU6JfG5KmZNv35E5";

// --- 3. INICIALIZACIÓN ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence);

try {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true
    });
} catch (e) { console.log("AppCheck activo"); }

const provider = new GoogleAuthProvider();
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// MEJORA AI STUDIO: Personalidad grabada a fuego en la inicialización
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    systemInstruction: "Eres el experto técnico exclusivo de ASYS AUTO. Tu ÚNICA fuente de verdad es la información técnica provista en cada consulta. Si un dato o respuesta no se encuentra en esa información, NO inventes ni asumas nada; pide disculpas y di que no tienes ese dato registrado para ese modelo."
});

let user = null;
let historialCargas = [];
let fotoBase64 = null;
let estadoAuto = { 
    tipoUso: "particular", combustibleComparativo: "Super 95",
    nombreUsuario: "", marcaModelo: "", matricula: "",
    capacidadBateria: 54.3, rendimientoAnterior: 12,
    nombreTaller: "", direccionTaller: "", telefonoTaller: "",
    precios: { hogarValle: 2.32, uteLenta: 7.54, uteRapida: 10.80, wallboxEspecial: 12.00 },
    combustibles: { "Super 95": 88.03, "Premium 97": 90.09, "Gasoil 10S": 66.27, "Gasoil 50-S": 57.72 }
};

// --- 4. GESTIÓN DE SESIÓN Y DATOS ---
onAuthStateChanged(auth, (u) => {
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    if (u) {
        user = u;
        if(loginScreen) loginScreen.classList.add('hidden');
        if(mainApp) mainApp.classList.remove('hidden');
        
        onSnapshot(query(collection(db, 'users', user.uid, 'cargas'), orderBy('fecha', 'desc')), (snap) => {
            historialCargas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderizarApp();
        });

        onSnapshot(doc(db, 'users', user.uid, 'config', 'general'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                estadoAuto = { ...estadoAuto, ...data };
                if (data.precios) estadoAuto.precios = { ...estadoAuto.precios, ...data.precios };
                if (data.combustibles) estadoAuto.combustibles = { ...estadoAuto.combustibles, ...data.combustibles };
                renderizarApp();
            }
        });
    } else {
        user = null;
        if(loginScreen) loginScreen.classList.remove('hidden');
        if(mainApp) mainApp.classList.add('hidden');
    }
});

// --- 5. LÓGICA DE CARGA Y COSTOS ---
const calcularCostoReal = (kwh, tarifa) => {
    const p = estadoAuto.precios;
    const k = parseFloat(kwh) || 0;
    const esPro = estadoAuto.tipoUso === 'profesional';
    if (tarifa === 'uteRapida') return (k * p.uteRapida) + (esPro ? 0 : 121.9);
    if (tarifa === 'uteLenta') return (k * p.uteLenta) + (esPro ? 0 : 40);
    if (tarifa === 'hogarValle') return (k * p.hogarValle * 1.22);
    return (k * p.wallboxEspecial * 1.22);
};

window.actualizarPreview = () => {
    let inicio = parseFloat(document.getElementById('bat-inicio')?.value);
    let fin = parseFloat(document.getElementById('bat-fin')?.value);
    const tarifa = document.getElementById('tipo-tarifa')?.value;
    const preview = document.getElementById('preview-costo');

    if (inicio < 0) inicio = 0; if (inicio > 100) inicio = 100;
    if (fin < 0) fin = 0; if (fin > 100) fin = 100;

    if (!isNaN(inicio) && !isNaN(fin) && tarifa && preview) {
        if (fin <= inicio) {
            preview.innerHTML = `<span class="text-orange-500 font-bold uppercase text-[10px]">El % final debe ser mayor</span>`;
            return;
        }
        const kwh = ((fin - inicio) / 100) * (estadoAuto.capacidadBateria || 54.3);
        const costo = calcularCostoReal(kwh, tarifa);
        preview.innerHTML = `<b>${kwh.toFixed(1)} kWh</b> | <b>$${costo.toFixed(0)}</b>`;
    }
};

window.registrarCarga = async (e) => {
    e.preventDefault();
    const km = parseFloat(document.getElementById('km').value) || 0;
    const inicio = parseFloat(document.getElementById('bat-inicio').value) || 0;
    const fin = parseFloat(document.getElementById('bat-fin').value) || 0;
    const tarifa = document.getElementById('tipo-tarifa').value;
    const esCien = document.getElementById('es-cien').checked;

    if (fin <= inicio) return alert("Error: El porcentaje final debe ser mayor al inicial.");
    const kmAnterior = historialCargas[0]?.km || 0;
    if (historialCargas.length > 0) {
        if (km <= kmAnterior) return alert("Error: El kilometraje debe ser mayor al anterior (" + kmAnterior + " km).");
        const dif = km - kmAnterior;
        if (dif > 400) return alert("Error: " + dif + " km excede la autonomía lógica.");
    }

    const kwh = ((fin - inicio) / 100) * (estadoAuto.capacidadBateria || 54.3);
    const costo = calcularCostoReal(kwh, tarifa);

    try {
        await addDoc(collection(db, 'users', user.uid, 'cargas'), {
            fecha: Date.now(), km, batIn: inicio, batFin: fin, kwhTotales: kwh, costo, tarifaLabel: tarifa, esCien
        });
        e.target.reset();
        // Nuestro arreglo de diseño que AI Studio borró
        document.getElementById('preview-costo').innerHTML = '<span class="text-[10px] uppercase text-zinc-500 font-bold tracking-widest">Esperando datos...</span>';
    } catch (err) { alert("Error al conectar con la base de datos."); }
};

// --- 6. ASISTENTE IA (CON CONSULTA MILIMÉTRICA Y TRACKERS) ---
window.preguntarIA = async () => {
    const prompt = document.getElementById('input-busqueda')?.value;
    const sug = document.getElementById('sugerencias-manual');
    if (!prompt && !fotoBase64) return;
    if(sug) sug.innerHTML = "<p class='text-blue-500 animate-pulse text-[10px] font-black uppercase'>Consultando Cerebro Central...</p>";

    console.log("-----------------------------------------");
    console.log(`1. Buscando manual exacto para: [${estadoAuto.marcaModelo}]`);

    try {
        let manualContexto = "";
        try {
            const snap = await getDocs(query(collection(db, 'conocimiento_autos'), where("modelo", "==", estadoAuto.marcaModelo || "")));
            
            if (snap.empty) {
                console.log("⚠️ ATENCIÓN: No hay un manual para esta versión específica en Firebase.");
            } else {
                console.log(`✅ ¡ÉXITO! Manual encontrado.`);
                snap.forEach(d => { 
                    const data = d.data();
                    const textoEncontrado = data.contenido || data.texto || data.info || data.datos || "";
                    manualContexto += textoEncontrado + "\n"; 
                });
            }
        } catch (e) {
            console.error("❌ Error al leer Firebase:", e);
        }

        // Nuestro escudo de seguridad que AI Studio omitió
        let instrucciones = "";
        if (manualContexto.trim() === "") {
            instrucciones = `El usuario acaba de hacer una pregunta, pero NO TIENES la información de su modelo (${estadoAuto.marcaModelo}) cargada. Discúlpate e indícale esto.\n\nPREGUNTA DEL USUARIO: ${prompt}`;
        } else {
            instrucciones = `Responde a la pregunta basándote en la siguiente información:\n\n--- MANUAL OFICIAL ---\n${manualContexto}\n----------------------\n\nPREGUNTA DEL USUARIO: ${prompt}`;
        }
        
        let partes = [{ text: instrucciones }];
        if (fotoBase64) {
            partes.push({ inlineData: { data: fotoBase64, mimeType: "image/jpeg" } });
            console.log("-> Foto detectada y adjuntada.");
        }

        console.log("2. Enviando paquete optimizado a Gemini 2.5 Flash...");
        const result = await model.generateContent({ contents: [{ parts: partes }] });
        const text = result.response.text();

        console.log("3. ¡Respuesta procesada con éxito!");

        if(sug) sug.innerHTML = `<div class="bg-blue-600/10 p-5 rounded-3xl border border-blue-500/20 text-zinc-200 text-sm leading-relaxed">${text.replace(/\n/g, '<br>')}</div>`;
        window.quitarFoto();
        if(document.getElementById('input-busqueda')) document.getElementById('input-busqueda').value = "";
        
    } catch (err) { 
        console.error("❌ ERROR FATAL DE GEMINI:", err); 
        if(sug) sug.innerHTML = "Error de conexión con IA. Revisa la consola (F12)."; 
    }
};

// --- 7. RENDERIZADO DE INTERFAZ ---
function renderizarApp() {
    try {
        const nameEl = document.getElementById('user-display-name');
        if(nameEl) nameEl.innerText = estadoAuto.nombreUsuario || user?.displayName || "Usuario";

        let ahorroTotal = 0;
        if (historialCargas.length >= 2) {
            const ordenadas = [...historialCargas].sort((a,b) => a.km - b.km);
            const precioNafta = estadoAuto.combustibles[estadoAuto.combustibleComparativo] || 88.03;
            
            let rendimientoSeguro = parseFloat(estadoAuto.rendimientoAnterior);
            if (isNaN(rendimientoSeguro) || rendimientoSeguro <= 0) rendimientoSeguro = 12;

            for(let i=1; i < ordenadas.length; i++){
                const dist = ordenadas[i].km - ordenadas[i-1].km;
                if (dist > 0) {
                    ahorroTotal += ((dist / rendimientoSeguro) * precioNafta) - (parseFloat(ordenadas[i].costo) || 0);
                }
            }
        }
        const ahorroEl = document.getElementById('ahorro-valor');
        if(ahorroEl) ahorroEl.innerText = `$ ${Math.round(ahorroTotal).toLocaleString('es-UY')}`;

        const fuelEl = document.getElementById('fuel-selectors');
        if(fuelEl) fuelEl.innerHTML = Object.keys(estadoAuto.combustibles).map(t => `<button onclick="window.cambiarCombustible('${t}')" class="p-2 rounded-xl border text-[9px] font-black uppercase ${estadoAuto.combustibleComparativo === t ? 'bg-green-600 border-green-500 text-white shadow-lg' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}">${t}</button>`).join('');

        let cargasSinCien = 0;
        for (let c of historialCargas) { if (c.esCien) break; cargasSinCien++; }
        const batEl = document.getElementById('card-bateria');
        if(batEl) batEl.innerHTML = `<div class="bg-zinc-900 border ${cargasSinCien >= 4 ? 'border-purple-500' : 'border-zinc-800'} p-6 rounded-[2.5rem] text-center mb-6 shadow-xl"><p class="text-[10px] text-zinc-500 uppercase font-black mb-2">BALANCEO LFP</p><p class="text-2xl font-black uppercase ${cargasSinCien >= 4 ? 'text-purple-400' : 'text-zinc-100'}">${cargasSinCien >= 4 ? '¡CARGAR AL 100% HOY!' : 'TOCA CARGA AL 80%'}</p></div>`;

        const kmActual = historialCargas[0]?.km || 0;
        const faltanKm = (Math.ceil((kmActual + 1) / 10000) * 10000) - kmActual;
        const mantEl = document.getElementById('card-mantenimiento');
        if(mantEl) mantEl.innerHTML = `<div class="bg-zinc-900 border border-zinc-800 p-6 rounded-[2.5rem] shadow-xl"><div class="flex justify-between items-center mb-2"><div><p class="text-zinc-500 text-[10px] uppercase font-black">Service Oficial</p><p class="text-2xl font-black ${faltanKm < 1000 ? 'text-orange-500' : 'text-zinc-100'}">Faltan ${faltanKm.toLocaleString()} km</p></div>${estadoAuto.telefonoTaller ? `<button onclick="window.solicitarService()" class="bg-green-600 p-3 rounded-full text-white shadow-lg"><i data-lucide="message-circle"></i></button>` : ''}</div><p class="text-[9px] text-zinc-600 uppercase font-bold">${estadoAuto.nombreTaller || 'Taller no configurado'}</p></div>`;

        const listaEl = document.getElementById('lista-cargas');
        if(listaEl) listaEl.innerHTML = historialCargas.slice(0, 5).map(c => `<div class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-2 flex justify-between items-center"><div><p class="font-bold text-sm text-zinc-200">${c.km.toLocaleString()} km</p><p class="text-[10px] text-zinc-600 uppercase">${new Date(c.fecha).toLocaleDateString()}</p></div><div class="flex items-center gap-4"><p class="text-green-500 font-bold text-sm">$${(parseFloat(c.costo)||0).toFixed(0)}</p><button onclick="window.eliminarRegistro('${c.id}')" class="text-zinc-800"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div>`).join('');
        
        if(typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) { console.log("Error render:", e); }
}

// --- 8. FUNCIONES GLOBALES ---
window.loginGoogle = async () => { try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); } };
window.logout = () => signOut(auth).then(() => location.reload());
window.toggleConfig = () => {
    const modal = document.getElementById('modal-config');
    if(!modal) return;
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        const fields = {
            'conf-nombre': estadoAuto.nombreUsuario, 'conf-modelo': estadoAuto.marcaModelo, 'conf-matricula': estadoAuto.matricula,
            'conf-tipo-uso': estadoAuto.tipoUso, 'conf-bat-cap': estadoAuto.capacidadBateria, 'conf-rend-ant': estadoAuto.rendimientoAnterior,
            'p-hogar': estadoAuto.precios.hogarValle, 'p-ute-l': estadoAuto.precios.uteLenta, 'p-ute-r': estadoAuto.precios.uteRapida, 'p-wallbox': estadoAuto.precios.wallboxEspecial,
            'p-super': estadoAuto.combustibles["Super 95"], 'p-premium': estadoAuto.combustibles["Premium 97"], 'p-gasoil10': estadoAuto.combustibles["Gasoil 10S"], 'p-gasoil50': estadoAuto.combustibles["Gasoil 50-S"],
            'conf-taller': estadoAuto.nombreTaller, 'conf-taller-dir': estadoAuto.direccionTaller, 'conf-taller-tel': estadoAuto.telefonoTaller, 'conf-tipo-nafta': estadoAuto.combustibleComparativo
        };
        for (let id in fields) { if(document.getElementById(id)) document.getElementById(id).value = fields[id] || ""; }
    }
};

window.guardarConfig = async (e) => {
    const btn = e.target;
    btn.innerText = "GUARDANDO...";
    const data = {
        nombreUsuario: document.getElementById('conf-nombre').value,
        marcaModelo: document.getElementById('conf-modelo').value,
        matricula: document.getElementById('conf-matricula').value,
        tipoUso: document.getElementById('conf-tipo-uso').value,
        capacidadBateria: parseFloat(document.getElementById('conf-bat-cap').value) || 54.3,
        rendimientoAnterior: parseFloat(document.getElementById('conf-rend-ant').value) || 12,
        precios: {
            hogarValle: parseFloat(document.getElementById('p-hogar').value),
            uteLenta: parseFloat(document.getElementById('p-ute-l').value),
            uteRapida: parseFloat(document.getElementById('p-ute-r').value),
            wallboxEspecial: parseFloat(document.getElementById('p-wallbox').value)
        },
        combustibles: {
            "Super 95": parseFloat(document.getElementById('p-super').value),
            "Premium 97": parseFloat(document.getElementById('p-premium').value),
            "Gasoil 10S": parseFloat(document.getElementById('p-gasoil10').value),
            "Gasoil 50-S": parseFloat(document.getElementById('p-gasoil50').value)
        },
        nombreTaller: document.getElementById('conf-taller').value,
        direccionTaller: document.getElementById('conf-taller-dir').value,
        telefonoTaller: document.getElementById('conf-taller-tel').value,
        combustibleComparativo: document.getElementById('conf-tipo-nafta').value
    };
    await setDoc(doc(db, 'users', user.uid, 'config', 'general'), data, { merge: true });
    btn.innerText = "¡LISTO! ✅";
    setTimeout(() => { window.toggleConfig(); btn.innerText = "Guardar Configuración"; }, 1000);
};

window.previsualizarFoto = () => {
    const file = document.getElementById('input-foto').files[0];
    const reader = new FileReader();
    reader.onloadend = () => {
        fotoBase64 = reader.result.split(',')[1];
        const img = document.getElementById('img-preview');
        const cont = document.getElementById('container-preview');
        if(img) img.src = reader.result;
        if(cont) cont.classList.remove('hidden');
    };
    if (file) reader.readAsDataURL(file);
};

window.quitarFoto = () => { fotoBase64 = null; document.getElementById('container-preview').classList.add('hidden'); };
window.cambiarCombustible = async (t) => { await setDoc(doc(db, 'users', user.uid, 'config', 'general'), { combustibleComparativo: t }, { merge: true }); };
window.eliminarRegistro = async (id) => { if(confirm("¿Eliminar?")) await deleteDoc(doc(db, 'users', user.uid, 'cargas', id)); };
window.solicitarService = () => {
    const msg = `Hola, soy ${estadoAuto.nombreUsuario}. Agendar service para ${estadoAuto.marcaModelo} (${estadoAuto.matricula}).`;
    window.open(`https://wa.me/${estadoAuto.telefonoTaller}?text=${encodeURIComponent(msg)}`, "_blank");
};
window.exportarExcel = () => {
    let csv = "Fecha,KM,Costo\n";
    historialCargas.forEach(c => { csv += `${new Date(c.fecha).toLocaleDateString()},${c.km},${c.costo}\n`; });
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "bitacora_asysauto.csv";
    link.click();
};

window.onload = () => { if(typeof lucide !== 'undefined') lucide.createIcons(); };
