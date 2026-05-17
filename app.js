import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app-check.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
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
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence);

try {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true
    });
} catch (e) {}

const provider = new GoogleAuthProvider();
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

// --- SESIÓN ---
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
            }
            renderizarApp();
        });
    } else {
        user = null;
        if(loginScreen) loginScreen.classList.remove('hidden');
        if(mainApp) mainApp.classList.add('hidden');
    }
});

// --- LÓGICA ---
const calcularCostoReal = (kwh, tarifa) => {
    const p = estadoAuto.precios;
    const k = parseFloat(kwh) || 0;
    const esPro = estadoAuto.tipoUso === 'profesional';
    if (tarifa === 'uteRapida') return (k * p.uteRapida) + (esPro ? 0 : 121.9);
    if (tarifa === 'uteLenta') return (k * p.uteLenta) + (esPro ? 0 : 40);
    if (tarifa === 'hogarValle') return (k * p.hogarValle * 1.22);
    return (k * p.wallboxEspecial * 1.22);
};

function renderizarApp() {
    try {
        const nameEl = document.getElementById('user-display-name');
        if(nameEl) nameEl.innerText = estadoAuto.nombreUsuario || user?.displayName || "Usuario";

        let ahorroTotal = 0;
        if (historialCargas.length >= 2) {
            const ordenadas = [...historialCargas].sort((a,b) => a.km - b.km);
            const precioNafta = estadoAuto.combustibles[estadoAuto.combustibleComparativo] || 88.03;
            for(let i=1; i < ordenadas.length; i++){
                const dist = ordenadas[i].km - ordenadas[i-1].km;
                if (dist > 0) ahorroTotal += ((dist / (estadoAuto.rendimientoAnterior || 12)) * precioNafta) - (parseFloat(ordenadas[i].costo) || 0);
            }
        }
        const ahorroEl = document.getElementById('ahorro-valor');
        if(ahorroEl) ahorroEl.innerText = `$ ${Math.round(ahorroTotal).toLocaleString('es-UY')}`;

        const fuelEl = document.getElementById('fuel-selectors');
        if(fuelEl) fuelEl.innerHTML = Object.keys(estadoAuto.combustibles).map(t => `<button onclick="window.cambiarCombustible('${t}')" class="p-2 rounded-xl border text-[9px] font-black uppercase ${estadoAuto.combustibleComparativo === t ? 'bg-green-600 border-green-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}">${t}</button>`).join('');

        let cargasSinCien = 0;
        for (let c of historialCargas) { if (c.esCien) break; cargasSinCien++; }
        const batEl = document.getElementById('card-bateria');
        if(batEl) batEl.innerHTML = `<div class="bg-zinc-900 border ${cargasSinCien >= 4 ? 'border-purple-500' : 'border-zinc-800'} p-6 rounded-[2.5rem] text-center mb-6 shadow-xl"><p class="text-2xl font-black uppercase">${cargasSinCien >= 4 ? 'CARGAR AL 100% HOY!' : 'TOCA CARGA AL 80%'}</p></div>`;

        const listaEl = document.getElementById('lista-cargas');
        if(listaEl) listaEl.innerHTML = historialCargas.slice(0, 5).map(c => `<div class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-2 flex justify-between items-center"><div><p class="font-bold text-sm text-zinc-200">${c.km.toLocaleString()} km</p></div><div class="flex items-center gap-4"><p class="text-green-500 font-bold">$${(parseFloat(c.costo)||0).toFixed(0)}</p><button onclick="window.eliminarRegistro('${c.id}')" class="text-zinc-800"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div>`).join('');
        
        if(typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) { console.log(e); }
}

// --- GLOBALES ---
window.loginGoogle = async () => { try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); } };
window.logout = () => signOut(auth).then(() => location.reload());
window.toggleConfig = () => {
    const modal = document.getElementById('modal-config');
    if(!modal) return;
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        document.getElementById('conf-nombre').value = estadoAuto.nombreUsuario || "";
        document.getElementById('conf-modelo').value = estadoAuto.marcaModelo || "";
        document.getElementById('conf-matricula').value = estadoAuto.matricula || "";
        document.getElementById('conf-tipo-uso').value = estadoAuto.tipoUso || "particular";
        document.getElementById('conf-bat-cap').value = estadoAuto.capacidadBateria || 54.3;
        document.getElementById('conf-rend-ant').value = estadoAuto.rendimientoAnterior || 12;
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
    setTimeout(() => { window.toggleConfig(); btn.innerText = "Guardar"; }, 1000);
};

window.actualizarPreview = () => {
    const inicio = parseFloat(document.getElementById('bat-inicio')?.value);
    const fin = parseFloat(document.getElementById('bat-fin')?.value);
    const tarifa = document.getElementById('tipo-tarifa')?.value;
    const preview = document.getElementById('preview-costo');
    if (!isNaN(inicio) && !isNaN(fin) && tarifa && preview) {
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
    const kwh = ((fin - inicio) / 100) * (estadoAuto.capacidadBateria || 54.3);
    const costo = calcularCostoReal(kwh, tarifa);
    await addDoc(collection(db, 'users', user.uid, 'cargas'), { fecha: Date.now(), km, batIn: inicio, batFin: fin, kwhTotales: kwh, costo, tarifaLabel: tarifa, esCien });
    e.target.reset();
};

window.preguntarIA = async () => {
    const prompt = document.getElementById('input-busqueda').value;
    const sug = document.getElementById('sugerencias-manual');
    if (!prompt && !fotoBase64) return;
    sug.innerHTML = "Analizando...";
    try {
        let partes = [prompt || "Analiza esta imagen."];
        if (fotoBase64) partes.push({ inlineData: { data: fotoBase64, mimeType: "image/jpeg" } });
        const result = await model.generateContent(partes);
        sug.innerHTML = `<div class="bg-blue-600/10 p-5 rounded-3xl border border-blue-500/20 text-zinc-200 text-sm">${result.response.text()}</div>`;
        window.quitarFoto();
    } catch (e) { sug.innerHTML = "Error de IA"; }
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

window.onload = () => { if(typeof lucide !== 'undefined') lucide.createIcons(); };
