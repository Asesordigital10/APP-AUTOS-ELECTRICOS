import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, deleteDoc, orderBy } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// --- CONFIGURACIÓN ---
const firebaseConfig = {
    apiKey: "AIzaSyA11UK2o8-EgE9vTTcw-eeA55yC-n9eZIg",
    authDomain: "app-autos-electricos-5a311.firebaseapp.com",
    projectId: "app-autos-electricos-5a311",
    storageBucket: "app-autos-electricos-5a311.firebasestorage.app",
    messagingSenderId: "877759630392",
    appId: "1:877759630392:web:eed9d7b0f1a99fd91c2acd"
};

const GEMINI_KEY = "AIzaSyDjz1zkuKIMw31cD4Clti6Cb2derh-lug0";
const RECAPTCHA_SITE_KEY = "6LdE3OosAAAAALzMd8EpS2gkNU6JfG5KmZNv35E5";

// --- INICIALIZACIÓN ---
const app = initializeApp(firebaseConfig);
const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
});

const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "Eres el asistente experto de ASYS AUTO. Ayuda a dueños de autos electricos."
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

// --- SESIÓN ---
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
            if (snap.exists()) { estadoAuto = { ...estadoAuto, ...snap.data() }; renderizarApp(); }
        });
    } else {
        user = null;
        loginScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
});

window.loginGoogle = async () => { try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); } };
window.logout = () => { if(confirm("¿Cerrar sesión?")) signOut(auth); };

// --- CARGAS ---
window.actualizarPreview = () => {
    const batIn = parseFloat(document.getElementById('bat-inicio').value);
    const batFin = parseFloat(document.getElementById('bat-fin').value);
    const tarifa = document.getElementById('tipo-tarifa').value;
    const preview = document.getElementById('preview-costo');
    if (!isNaN(batIn) && !isNaN(batFin) && tarifa) {
        const kwh = ((batFin - batIn) / 100) * estadoAuto.capacidadBateria;
        const p = estadoAuto.precios;
        let costo = 0;
        if (tarifa === 'uteRapida') costo = (kwh * p.uteRapida) + 121.9;
        else if (tarifa === 'uteLenta') costo = (kwh * p.uteLenta) + 40;
        else if (tarifa === 'hogarValle') costo = (kwh * p.hogarValle * 1.22) + 122;
        else costo = (kwh * p.wallboxEspecial * 1.22);
        preview.innerHTML = `<b>${kwh.toFixed(1)} kWh</b> | <b>$${costo.toFixed(0)}</b>`;
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
    const p = estadoAuto.precios;
    let costo = 0;
    if (tarifa === 'uteRapida') costo = (kwhTotales * p.uteRapida) + 121.9;
    else if (tarifa === 'uteLenta') costo = (kwhTotales * p.uteLenta) + 40;
    else if (tarifa === 'hogarValle') costo = (kwhTotales * p.hogarValle * 1.22) + 122;
    else costo = (kwhTotales * p.wallboxEspecial * 1.22);

    await addDoc(collection(db, 'users', user.uid, 'cargas'), { fecha: Date.now(), km, batIn, batFin, kwhTotales, costo, tarifaLabel: tarifa, esCien });
    e.target.reset();
    document.getElementById('preview-costo').innerText = "REGISTRADO ✅";
};

// --- IA ---
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
    document.getElementById('container-preview').classList.add('hidden');
};

window.preguntarIA = async () => {
    const prompt = document.getElementById('input-busqueda').value;
    const sugerencias = document.getElementById('sugerencias-manual');
    if (!prompt && !fotoBase64) return;
    sugerencias.innerHTML = "Analizando...";
    try {
        let partes = [prompt || "Analiza esta imagen."];
        if (fotoBase64) partes.push({ inlineData: { data: fotoBase64, mimeType: "image/jpeg" } });
        const result = await model.generateContent(partes);
        const response = await result.response;
        sugerencias.innerHTML = `<div class="bg-blue-600/10 p-5 rounded-3xl border border-blue-500/20 text-zinc-200 text-sm">${response.text()}</div>`;
        window.quitarFoto();
        document.getElementById('input-busqueda').value = "";
    } catch (e) { sugerencias.innerHTML = "Error de IA"; }
};

// --- CONFIG ---
window.toggleConfig = () => document.getElementById('modal-config').classList.toggle('hidden');

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
    btn.innerText = "LISTO! ✅";
    setTimeout(() => { toggleConfig(); btn.innerText = "Guardar Configuración"; }, 1000);
};

function renderizarApp() {
    const kmActual = historialCargas[0]?.km || 0;
    let cargasSinCien = 0;
    for (let c of historialCargas) { if (c.esCien) break; cargasSinCien++; }
    
    document.getElementById('card-bateria').innerHTML = `<div class="bg-zinc-900 border ${cargasSinCien >= 4 ? 'border-purple-500' : 'border-zinc-800'} p-6 rounded-[2.5rem] text-center mb-6"><p class="text-2xl font-black uppercase">${cargasSinCien >= 4 ? 'CARGAR AL 100% HOY!' : 'TOCA CARGA AL 80%'}</p></div>`;

    let ahorroTotal = 0;
    if (historialCargas.length > 1) {
        const ordenadas = [...historialCargas].sort((a,b) => a.km - b.km);
        const precioNafta = estadoAuto.combustibles[estadoAuto.combustibleComparativo];
        for(let i=1; i < ordenadas.length; i++){
            const dist = ordenadas[i].km - ordenadas[i-1].km;
            if (dist > 0) {
                const costoNafta = (dist / estadoAuto.rendimientoAnterior) * precioNafta;
                ahorroTotal += (costoNafta - ordenadas[i].costo);
            }
        }
    }

    document.getElementById('ahorro-valor').innerText = `$ ${ahorroTotal.toLocaleString('es-UY', {maximumFractionDigits:0})}`;
    document.getElementById('user-display-name').innerText = estadoAuto.nombreUsuario || user.displayName || "Usuario";
    
    const lista = document.getElementById('lista-cargas');
    lista.innerHTML = historialCargas.slice(0, 5).map(c => `<div class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-2 flex justify-between items-center"><div><p class="font-bold text-zinc-200">${c.km.toLocaleString()} km</p><p class="text-[10px] text-zinc-600 uppercase">${new Date(c.fecha).toLocaleDateString()}</p></div><p class="text-green-500 font-bold">$${c.costo.toFixed(0)}</p></div>`).join('');
    lucide.createIcons();
}

window.cambiarCombustible = async (t) => { await setDoc(doc(db, 'users', user.uid, 'config', 'general'), { combustibleComparativo: t }, { merge: true }); };
window.eliminarRegistro = async (id) => { if(confirm("¿Eliminar?")) await deleteDoc(doc(db, 'users', user.uid, 'cargas', id)); };
window.exportarExcel = () => {
    let csv = "Fecha,KM,Costo\n";
    historialCargas.forEach(c => { csv += `${new Date(c.fecha).toLocaleDateString()},${c.km},${c.costo}\n`; });
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "bitacora.csv";
    link.click();
};

window.registrarCargaForm = registrarCarga;
window.onload = () => { lucide.createIcons(); };
