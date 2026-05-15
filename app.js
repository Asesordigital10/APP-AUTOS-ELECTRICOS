import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, deleteDoc, orderBy } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// --- CONFIGURACIÓN ---
const firebaseConfig = {
    apiKey: "AIzaSyDjz1zkuKIMw31cD4Clti6Cb2derh-lug0",
    authDomain: "app-autos-electricos-5a311.firebaseapp.com",
    projectId: "app-autos-electricos-5a311",
    storageBucket: "app-autos-electricos-5a311.firebasestorage.app",
    messagingSenderId: "877759630392",
    appId: "1:877759630392:web:eed9d7b0f1a99fd91c2acd"
};

const GEMINI_KEY = "TU_API_KEY_AQUI"; // Pon tu clave de Google AI Studio

// --- INICIALIZACIÓN ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "Eres el asistente experto de ASYS AUTO. Conoces todo sobre autos eléctricos y funciones de pantalla. Responde de forma técnica pero amigable. Si te envían una foto, analízala detalladamente."
});

let user = null;
let historialCargas = [];
let fotoBase64 = null;
let estadoAuto = { 
    combustibleComparativo: "Super 95",
    nombreUsuario: "", marcaModelo: "", matricula: "",
    capacidadBateria: 54.3, rendimientoAnterior: 12,
    nombreTaller: "", direccionTaller: "", telefonoTaller: "",
    precios: { hogarValle: 2.32, uteLenta: 7.54, uteRapida: 10.80, wallboxEspecial: 12.00 },
    combustibles: { "Super 95": 88.03, "Premium 97": 90.09, "Gasoil 10S": 66.27, "Gasoil 50-S": 57.72 }
};

// --- AUTENTICACIÓN ---
window.loginGoogle = async () => { try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); } };
window.logout = () => { if(confirm("¿Cerrar sesión?")) signOut(auth); };

onAuthStateChanged(auth, (u) => {
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    if (u) {
        user = u;
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        onSnapshot(query(collection(db, 'users', user.uid, 'cargas'), orderBy('fecha', 'desc')), (snap) => {
            historialCargas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderizarApp();
        });
        onSnapshot(doc(db, 'users', user.uid, 'config', 'general'), (snap) => {
            if (snap.exists()) { 
                const data = snap.data();
                estadoAuto = { ...estadoAuto, ...data };
                renderizarApp(); 
            }
        });
    } else {
        user = null;
        loginScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
});

// --- LÓGICA DE CARGA ---
const calcularCostoReal = (kwh, tarifa) => {
    const p = estadoAuto.precios;
    if (tarifa === 'uteRapida') return (kwh * p.uteRapida) + 121.9;
    if (tarifa === 'uteLenta') return (kwh * p.uteLenta) + 40;
    if (tarifa === 'hogarValle') return (kwh * p.hogarValle * 1.22) + (100 * 1.22);
    return (kwh * p.wallboxEspecial * 1.22);
};

window.actualizarPreview = () => {
    const batIn = parseFloat(document.getElementById('bat-inicio').value);
    const batFin = parseFloat(document.getElementById('bat-fin').value);
    const tarifa = document.getElementById('tipo-tarifa').value;
    const preview = document.getElementById('preview-costo');
    if (!isNaN(batIn) && !isNaN(batFin) && tarifa) {
        const kwh = ((batFin - batIn) / 100) * estadoAuto.capacidadBateria;
        const costo = calcularCostoReal(kwh, tarifa);
        preview.innerHTML = `<span class="text-blue-400 font-bold">${kwh.toFixed(1)} kWh</span> | <span class="text-green-500 font-bold">$${costo.toFixed(0)}</span>`;
    }
};

window.registrarCarga = async (e) => {
    e.preventDefault();
    const km = parseFloat(document.getElementById('km').value);
    const batIn = parseFloat(document.getElementById('bat-inicio').value);
    const batFin = parseFloat(document.getElementById('bat-fin').value);
    const tarifa = document.getElementById('tipo-tarifa').value;
    const esCien = document.getElementById('es-cien').checked;
    const kwhTotales = ((batFin - batIn) / 100) * estadoAuto.capacidadBateria;
    const costo = calcularCostoReal(kwhTotales, tarifa);
    await addDoc(collection(db, 'users', user.uid, 'cargas'), { fecha: Date.now(), km, batIn, batFin, kwhTotales, costo, tarifaLabel: tarifa, esCien });
    e.target.reset();
    actualizarPreview();
};

// --- IA Y VISION ---
window.previsualizarFoto = () => {
    const file = document.getElementById('input-foto').files[0];
    const reader = new FileReader();
    reader.onloadend = () => {
        fotoBase64 = reader.result.split(',')[1];
        document.getElementById('img-preview').src = reader.result;
        document.getElementById('container-preview').classList.remove('hidden');
    };
    if (file) reader.readAsDataURL(file);
};

window.quitarFoto = () => {
    fotoBase64 = null;
    document.getElementById('input-foto').value = "";
    document.getElementById('container-preview').classList.add('hidden');
};

window.preguntarIA = async () => {
    const prompt = document.getElementById('input-busqueda').value;
    const sugerencias = document.getElementById('sugerencias-manual');
    if (!prompt && !fotoBase64) return;
    sugerencias.innerHTML = "<p class='text-blue-500 animate-pulse text-[10px] font-black uppercase'>Analizando...</p>";
    try {
        let partes = [prompt || "Analiza esta imagen."];
        if (fotoBase64) partes.push({ inlineData: { data: fotoBase64, mimeType: "image/jpeg" } });
        const result = await model.generateContent(partes);
        const response = await result.response;
        sugerencias.innerHTML = `<div class="bg-blue-600/10 p-5 rounded-3xl border border-blue-500/20 text-zinc-200 text-sm leading-relaxed">${response.text().replace(/\n/g, '<br>')}</div>`;
        quitarFoto();
        document.getElementById('input-busqueda').value = "";
    } catch (e) { sugerencias.innerHTML = "Error de IA"; }
};

// --- CONFIGURACIÓN Y UI ---
window.toggleConfig = () => {
    const modal = document.getElementById('modal-config');
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        document.getElementById('conf-nombre').value = estadoAuto.nombreUsuario || "";
        document.getElementById('conf-modelo').value = estadoAuto.marcaModelo || "";
        document.getElementById('conf-matricula').value = estadoAuto.matricula || "";
        document.getElementById('p-hogar').value = estadoAuto.precios.hogarValle;
        document.getElementById('p-ute-l').value = estadoAuto.precios.uteLenta;
        document.getElementById('p-ute-r').value = estadoAuto.precios.uteRapida;
        document.getElementById('p-wallbox').value = estadoAuto.precios.wallboxEspecial;
        document.getElementById('p-super').value = estadoAuto.combustibles["Super 95"];
        document.getElementById('p-premium').value = estadoAuto.combustibles["Premium 97"];
        document.getElementById('p-gasoil10').value = estadoAuto.combustibles["Gasoil 10S"];
        document.getElementById('p-gasoil50').value = estadoAuto.combustibles["Gasoil 50-S"];
        document.getElementById('conf-taller').value = estadoAuto.nombreTaller || "";
        document.getElementById('conf-taller-dir').value = estadoAuto.direccionTaller || "";
        document.getElementById('conf-taller-tel').value = estadoAuto.telefonoTaller || "";
        document.getElementById('conf-tipo-nafta').value = estadoAuto.combustibleComparativo || "Super 95";
    }
};

window.guardarConfig = async (e) => {
    const btn = e.target;
    btn.innerText = "GUARDANDO...";
    const data = {
        nombreUsuario: document.getElementById('conf-nombre').value,
        marcaModelo: document.getElementById('conf-modelo').value,
        matricula: document.getElementById('conf-matricula').value,
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
    btn.innerText = "¡GUARDADO! ✅";
    setTimeout(() => { toggleConfig(); btn.innerText = "Guardar Configuración"; }, 1000);
};

function renderizarApp() {
    const kmActual = historialCargas[0]?.km || 0;
    const proximoService = Math.ceil((kmActual + 1) / 10000) * 10000;
    const faltanKm = proximoService - kmActual;
    let cargasSinCien = 0;
    for (let c of historialCargas) { if (c.esCien) break; cargasSinCien++; }
    const necesitaBal = cargasSinCien >= 4;

    document.getElementById('card-bateria').innerHTML = `
        <div class="bg-zinc-900 border ${necesitaBal ? 'border-purple-500 ring-2 ring-purple-500/20' : 'border-zinc-800'} p-6 rounded-[2.5rem] shadow-xl text-center mb-6">
            <p class="text-zinc-500 text-[10px] uppercase font-black tracking-widest mb-2">BALANCEO LFP</p>
            <p class="text-2xl font-black ${necesitaBal ? 'text-purple-400' : 'text-zinc-100'} uppercase">
                ${necesitaBal ? '¡CARGAR AL 100% HOY!' : 'TOCA CARGA AL 80%'}
            </p>
        </div>`;

    let ahorroTotal = 0;
    if (historialCargas.length > 1) {
        const ordenadas = [...historialCargas].sort((a,b) => a.km - b.km);
        const precioNafta = estadoAuto.combustibles[estadoAuto.combustibleComparativo];
        for(let i=1; i < ordenadas.length; i++){
            const dist = ordenadas[i].km - ordenadas[i-1].km;
            if (dist > 0) {
                const costoEV = ordenadas[i].costo;
                const costoNafta = (dist / estadoAuto.rendimientoAnterior) * precioNafta;
                ahorroTotal += (costoNafta - costoEV);
            }
        }
    }

    document.getElementById('ahorro-valor').innerText = `$ ${ahorroTotal.toLocaleString('es-UY', {maximumFractionDigits:0})}`;
    document.getElementById('user-display-name').innerText = estadoAuto.nombreUsuario || user.displayName || "Usuario";
    document.getElementById('car-display-model').innerText = estadoAuto.marcaModelo ? `${estadoAuto.marcaModelo} | Telemetría Activa` : "Telemetría Activa";
    
    document.getElementById('fuel-selectors').innerHTML = Object.keys(estadoAuto.combustibles).map(t => `
        <button onclick="cambiarCombustible('${t}')" class="p-2 rounded-xl border text-[9px] font-black uppercase transition-all ${estadoAuto.combustibleComparativo === t ? 'bg-green-600 border-green-500 text-white shadow-lg' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}">${t}</button>
    `).join('');

    document.getElementById('card-mantenimiento').innerHTML = `
        <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-[2.5rem] shadow-xl">
            <div class="flex justify-between items-center mb-4">
                <div><p class="text-zinc-500 text-[10px] uppercase font-black tracking-widest">Service Oficial</p><p class="text-2xl font-black ${faltanKm < 1000 ? 'text-orange-500' : 'text-zinc-100'}">Faltan ${faltanKm.toLocaleString()} km</p></div>
                ${estadoAuto.telefonoTaller ? `<button onclick="solicitarService()" class="bg-green-600 p-3 rounded-full text-white shadow-lg active:scale-90"><i data-lucide="message-circle"></i></button>` : ''}
            </div>
            <p class="text-[9px] text-zinc-600 uppercase font-bold">${estadoAuto.nombreTaller || 'Taller no configurado'}</p>
        </div>`;

    const lista = document.getElementById('lista-cargas');
    lista.innerHTML = historialCargas.slice(0, 5).map(c => `
        <div class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-2 flex justify-between items-center backdrop-blur-sm">
            <div><p class="font-bold text-sm text-zinc-200">${c.km.toLocaleString()} km ${c.esCien ? '⭐' : ''}</p><p class="text-[10px] text-zinc-600 uppercase font-mono">${new Date(c.fecha).toLocaleDateString()}</p></div>
            <div class="flex items-center gap-4"><div class="text-right"><p class="text-green-500 font-bold text-sm">$${c.costo.toFixed(0)}</p><p class="text-[10px] text-zinc-600">${c.kwhTotales.toFixed(1)} kWh</p></div><button onclick="eliminarRegistro('${c.id}')" class="text-zinc-800 hover:text-red-500 active:scale-75 transition-transform"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>
        </div>
    `).join('');
    lucide.createIcons();
}

window.cambiarCombustible = async (t) => { await setDoc(doc(db, 'users', user.uid, 'config', 'general'), { combustibleComparativo: t }, { merge: true }); };
window.eliminarRegistro = async (id) => { if(confirm("¿Eliminar?")) await deleteDoc(doc(db, 'users', user.uid, 'cargas', id)); };
window.solicitarService = () => {
    const kmActual = historialCargas[0]?.km || 0;
    const msg = `Hola ${estadoAuto.nombreTaller}, mi nombre es ${estadoAuto.nombreUsuario}. Quisiera agendar un service para mi ${estadoAuto.marcaModelo} (Matrícula: ${estadoAuto.matricula}). Actualmente tiene ${kmActual} km.`;
    window.open(`https://wa.me/${estadoAuto.telefonoTaller}?text=${encodeURIComponent(msg)}`, "_blank");
};
window.exportarExcel = () => {
    let csv = "Carga #,Fecha,KM Tablero,KM Recorridos,% Cargado,Costo ($)\n";
    const ordenadas = [...historialCargas].sort((a,b) => a.fecha - b.fecha);
    ordenadas.forEach((c, i) => {
        const fecha = new Date(c.fecha).toLocaleDateString();
        const kmRecorridos = i > 0 ? c.km - ordenadas[i-1].km : 0;
        csv += `${i+1},${fecha},${c.km},${kmRecorridos},${c.batFin - c.batIn}%,${c.costo.toFixed(0)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "bitacora_asysauto.csv");
    link.click();
};

window.onload = () => { lucide.createIcons(); };
window.registrarCargaForm = registrarCarga;
