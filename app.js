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

const provider = new GoogleAuthProvider();
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

let user = null;
let historialCargas = [];
let estadoAuto = { 
    tipoUso: "particular", // 'particular' o 'profesional'
    combustibleComparativo: "Super 95",
    nombreUsuario: "", marcaModelo: "", matricula: "",
    capacidadBateria: 54.3, rendimientoAnterior: 12,
    nombreTaller: "", direccionTaller: "", telefonoTaller: "",
    precios: { hogarValle: 2.32, uteLenta: 7.54, uteRapida: 10.80, wallboxEspecial: 12.00 },
    combustibles: { "Super 95": 88.03, "Premium 97": 90.09, "Gasoil 10S": 66.27, "Gasoil 50-S": 57.72 }
};

// --- LÓGICA DE COSTOS SEGÚN NORMATIVA UTE ---
const calcularCostoReal = (kwh, tarifa) => {
    const p = estadoAuto.precios;
    const k = parseFloat(kwh) || 0;
    const esPro = estadoAuto.tipoUso === 'profesional';

    if (tarifa === 'uteRapida') {
        // Cargo base $121.9 solo para particulares
        const cargoBase = esPro ? 0 : 121.9;
        return (k * p.uteRapida) + cargoBase;
    }
    if (tarifa === 'uteLenta') {
        // Cargo base $40 solo para particulares
        const cargoBase = esPro ? 0 : 40;
        return (k * p.uteLenta) + cargoBase;
    }
    if (tarifa === 'hogarValle') {
        // Hogar no tiene cargo base por conexión, pero sumamos IVA (1.22)
        return (k * p.hogarValle * 1.22);
    }
    // Otros / Wallbox
    return (k * p.wallboxEspecial * 1.22);
};

// --- SINCRONIZACIÓN ---
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
                if (data.precios) estadoAuto.precios = { ...estadoAuto.precios, ...data.precios };
                if (data.combustibles) estadoAuto.combustibles = { ...estadoAuto.combustibles, ...data.combustibles };
                renderizarApp();
            }
        });
    } else {
        user = null;
        loginScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
});

window.actualizarPreview = () => {
    const batIn = parseFloat(document.getElementById('bat-inicio').value);
    const batFin = parseFloat(document.getElementById('bat-fin').value);
    const tarifa = document.getElementById('tipo-tarifa').value;
    const preview = document.getElementById('preview-costo');
    if (!isNaN(batIn) && !isNaN(batFin) && tarifa) {
        const kwh = ((batFin - batIn) / 100) * estadoAuto.capacidadBateria;
        const costo = calcularCostoReal(kwh, tarifa);
        preview.innerHTML = `<b>${kwh.toFixed(1)} kWh</b> | <b>$${costo.toFixed(0)}</b>`;
    }
};

window.registrarCarga = async (e) => {
    e.preventDefault();
    const km = parseFloat(document.getElementById('km').value) || 0;
    const batIn = parseFloat(document.getElementById('bat-inicio').value) || 0;
    const batFin = parseFloat(document.getElementById('bat-fin').value) || 0;
    const tarifa = document.getElementById('tipo-tarifa').value;
    const esCien = document.getElementById('es-cien').checked;
    
    const kwhTotales = ((batFin - batIn) / 100) * estadoAuto.capacidadBateria;
    const costo = calcularCostoReal(kwhTotales, tarifa);

    await addDoc(collection(db, 'users', user.uid, 'cargas'), {
        fecha: Date.now(), km, batIn, batFin, kwhTotales, costo, tarifaLabel: tarifa, esCien
    });
    e.target.reset();
    document.getElementById('preview-costo').innerText = "REGISTRADO ✅";
};

window.toggleConfig = () => {
    const modal = document.getElementById('modal-config');
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
    const originalText = btn.innerText;
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
    setTimeout(() => { window.toggleConfig(); btn.innerText = originalText; }, 1000);
};

function renderizarApp() {
    let ahorroTotal = 0;
    if (historialCargas.length >= 2) {
        const ordenadas = [...historialCargas].sort((a,b) => a.km - b.km);
        const precioNafta = estadoAuto.combustibles[estadoAuto.combustibleComparativo] || 88.03;
        for(let i=1; i < ordenadas.length; i++){
            const dist = ordenadas[i].km - ordenadas[i-1].km;
            const costoEV = parseFloat(ordenadas[i].costo) || 0;
            if (dist > 0) {
                const costoNaftaEquiv = (dist / estadoAuto.rendimientoAnterior) * precioNafta;
                ahorroTotal += (costoNaftaEquiv - costoEV);
            }
        }
    }
    document.getElementById('ahorro-valor').innerText = `$ ${Math.round(ahorroTotal).toLocaleString('es-UY')}`;
    document.getElementById('user-display-name').innerText = estadoAuto.nombreUsuario || user.displayName || "Usuario";
    document.getElementById('car-display-model').innerText = estadoAuto.marcaModelo || "Telemetría Activa";
    
    const lista = document.getElementById('lista-cargas');
    lista.innerHTML = historialCargas.slice(0, 5).map(c => `<div class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-2 flex justify-between items-center"><div><p class="font-bold text-zinc-200">${c.km.toLocaleString()} km</p><p class="text-[10px] text-zinc-600 uppercase">${new Date(c.fecha).toLocaleDateString()}</p></div><p class="text-green-500 font-bold">$${(parseFloat(c.costo)||0).toFixed(0)}</p></div>`).join('');
    lucide.createIcons();
}

window.loginGoogle = async () => { try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); } };
window.logout = () => { if(confirm("¿Cerrar sesión?")) { signOut(auth); location.reload(); } };
window.cambiarCombustible = async (t) => { await setDoc(doc(db, 'users', user.uid, 'config', 'general'), { combustibleComparativo: t }, { merge: true }); };
window.eliminarRegistro = async (id) => { if(confirm("¿Eliminar?")) await deleteDoc(doc(db, 'users', user.uid, 'cargas', id)); };
window.onload = () => { lucide.createIcons(); };
