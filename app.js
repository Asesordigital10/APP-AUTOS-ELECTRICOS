import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, deleteDoc, orderBy } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

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

// VALORES INICIALES Y POR DEFECTO
let estadoAuto = { 
    combustibleComparativo: "Super 95",
    nombreUsuario: "", marcaModelo: "", matricula: "",
    capacidadBateria: 54.3, rendimientoAnterior: 12,
    nombreTaller: "", direccionTaller: "", telefonoTaller: "",
    precios: { hogarValle: 2.32, uteLenta: 7.54, uteRapida: 10.80, wallboxEspecial: 12.00 },
    combustibles: { "Super 95": 88.03, "Premium 97": 90.09, "Gasoil 10S": 66.27, "Gasoil 50-S": 57.72 }
};

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
                // Mezcla profunda para no perder sub-objetos
                estadoAuto = { 
                    ...estadoAuto, 
                    ...data,
                    precios: { ...estadoAuto.precios, ...(data.precios || {}) },
                    combustibles: { ...estadoAuto.combustibles, ...(data.combustibles || {}) }
                };
                renderizarApp(); 
            }
        });
    } else {
        user = null;
        loginScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
});

window.loginGoogle = async () => { try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); } };
window.logout = () => { if(confirm("¿Cerrar sesión?")) signOut(auth); };

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
    const originalText = btn.innerText;
    btn.innerText = "GUARDANDO...";
    
    const data = {
        nombreUsuario: document.getElementById('conf-nombre').value,
        marcaModelo: document.getElementById('conf-modelo').value,
        matricula: document.getElementById('conf-matricula').value,
        precios: {
            hogarValle: parseFloat(document.getElementById('p-hogar').value) || 2.32,
            uteLenta: parseFloat(document.getElementById('p-ute-l').value) || 7.54,
            uteRapida: parseFloat(document.getElementById('p-ute-r').value) || 10.80,
            wallboxEspecial: parseFloat(document.getElementById('p-wallbox').value) || 12.00
        },
        combustibles: {
            "Super 95": parseFloat(document.getElementById('p-super').value) || 88.03,
            "Premium 97": parseFloat(document.getElementById('p-premium').value) || 90.09,
            "Gasoil 10S": parseFloat(document.getElementById('p-gasoil10').value) || 66.27,
            "Gasoil 50-S": parseFloat(document.getElementById('p-gasoil50').value) || 57.72
        },
        nombreTaller: document.getElementById('conf-taller').value,
        direccionTaller: document.getElementById('conf-taller-dir').value,
        telefonoTaller: document.getElementById('conf-taller-tel').value,
        combustibleComparativo: document.getElementById('conf-tipo-nafta').value
    };

    await setDoc(doc(db, 'users', user.uid, 'config', 'general'), data, { merge: true });
    btn.innerText = "LISTO! ✅";
    setTimeout(() => { window.toggleConfig(); btn.innerText = originalText; }, 1000);
};

function renderizarApp() {
    const kmActual = historialCargas[0]?.km || 0;
    let cargasSinCien = 0;
    for (let c of historialCargas) { if (c.esCien) break; cargasSinCien++; }
    
    document.getElementById('card-bateria').innerHTML = `<div class="bg-zinc-900 border ${cargasSinCien >= 4 ? 'border-purple-500' : 'border-zinc-800'} p-6 rounded-[2.5rem] text-center mb-6 shadow-xl"><p class="text-[10px] text-zinc-500 uppercase font-black mb-2">BALANCEO LFP</p><p class="text-2xl font-black ${cargasSinCien >= 4 ? 'text-purple-400' : 'text-zinc-100'} uppercase">${cargasSinCien >= 4 ? '¡CARGAR AL 100% HOY!' : 'TOCA CARGA AL 80%'}</p></div>`;

    let ahorroTotal = 0;
    if (historialCargas.length > 1) {
        const ordenadas = [...historialCargas].sort((a,b) => a.km - b.km);
        const precioNafta = estadoAuto.combustibles[estadoAuto.combustibleComparativo] || 88.03;
        for(let i=1; i < ordenadas.length; i++){
            const dist = ordenadas[i].km - ordenadas[i-1].km;
            if (dist > 0) {
                const costoNafta = (dist / estadoAuto.rendimientoAnterior) * precioNafta;
                ahorroTotal += (costoNafta - ordenadas[i].costo);
            }
        }
    }

    const ahorroEl = document.getElementById('ahorro-valor');
    if (isNaN(ahorroTotal)) {
        ahorroEl.innerText = "$ 0";
    } else {
        ahorroEl.innerText = `$ ${ahorroTotal.toLocaleString('es-UY', {maximumFractionDigits:0})}`;
    }

    document.getElementById('user-display-name').innerText = estadoAuto.nombreUsuario || user.displayName || "Usuario";
    document.getElementById('car-display-model').innerText = estadoAuto.marcaModelo || "Telemetría Activa";
    
    document.getElementById('fuel-selectors').innerHTML = Object.keys(estadoAuto.combustibles).map(t => `<button onclick="window.cambiarCombustible('${t}')" class="p-2 rounded-xl border text-[9px] font-black uppercase transition-all ${estadoAuto.combustibleComparativo === t ? 'bg-green-600 border-green-500 text-white shadow-lg' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}">${t}</button>`).join('');

    const lista = document.getElementById('lista-cargas');
    lista.innerHTML = historialCargas.slice(0, 5).map(c => `<div class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-2 flex justify-between items-center backdrop-blur-sm"><div><p class="font-bold text-sm text-zinc-200">${c.km.toLocaleString()} km</p><p class="text-[10px] text-zinc-600 uppercase font-mono">${new Date(c.fecha).toLocaleDateString()}</p></div><p class="text-green-500 font-bold text-sm">$${c.costo.toFixed(0)}</p></div>`).join('');
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
    link.download = "bitacora_asysauto.csv";
    link.click();
};

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

window.onload = () => { lucide.createIcons(); };
