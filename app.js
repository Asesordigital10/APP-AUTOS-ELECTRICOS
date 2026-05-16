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

// 1. INICIALIZACIÓN INMEDIATA
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Configurar persistencia ANTES de cualquier otra cosa
setPersistence(auth, browserLocalPersistence);

const provider = new GoogleAuthProvider();
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

let user = null;
let historialCargas = [];
let estadoAuto = { 
    combustibleComparativo: "Super 95",
    nombreUsuario: "", marcaModelo: "", matricula: "",
    capacidadBateria: 54.3, rendimientoAnterior: 12,
    nombreTaller: "", direccionTaller: "", telefonoTaller: "",
    precios: { hogarValle: 2.32, uteLenta: 7.54, uteRapida: 10.80, wallboxEspecial: 12.00 },
    combustibles: { "Super 95": 88.03, "Premium 97": 90.09, "Gasoil 10S": 66.27, "Gasoil 50-S": 57.72 }
};

// 2. ESCUCHA DE DATOS (Sincronización Nube -> App)
onAuthStateChanged(auth, (u) => {
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    if (u) {
        user = u;
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        
        // Escuchar Cargas
        onSnapshot(query(collection(db, 'users', user.uid, 'cargas'), orderBy('fecha', 'desc')), (snap) => {
            historialCargas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderizarApp();
        });

        // Escuchar Configuración y actualizar la variable global estadoAuto
        onSnapshot(doc(db, 'users', user.uid, 'config', 'general'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                // Mezcla profunda para asegurar que no se pierdan datos
                estadoAuto = { ...estadoAuto, ...data };
                if (data.precios) estadoAuto.precios = { ...estadoAuto.precios, ...data.precios };
                if (data.combustibles) estadoAuto.combustibles = { ...estadoAuto.combustibles, ...data.combustibles };
                renderizarApp();
                console.log("Configuración cargada desde la nube");
            }
        });
    } else {
        user = null;
        loginScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
});

// 3. FUNCIONES DE CONFIGURACIÓN
window.toggleConfig = () => {
    const modal = document.getElementById('modal-config');
    modal.classList.toggle('hidden');
    
    // Si el modal se está abriendo, rellenar los campos con los datos actuales
    if (!modal.classList.contains('hidden')) {
        document.getElementById('conf-nombre').value = estadoAuto.nombreUsuario || "";
        document.getElementById('conf-modelo').value = estadoAuto.marcaModelo || "";
        document.getElementById('conf-matricula').value = estadoAuto.matricula || "";
        
        // Precios Energía
        document.getElementById('p-hogar').value = estadoAuto.precios.hogarValle || 2.32;
        document.getElementById('p-ute-l').value = estadoAuto.precios.uteLenta || 7.54;
        document.getElementById('p-ute-r').value = estadoAuto.precios.uteRapida || 10.80;
        document.getElementById('p-wallbox').value = estadoAuto.precios.wallboxEspecial || 12.00;
        
        // Precios Combustible
        document.getElementById('p-super').value = estadoAuto.combustibles["Super 95"] || 88.03;
        document.getElementById('p-premium').value = estadoAuto.combustibles["Premium 97"] || 90.09;
        document.getElementById('p-gasoil10').value = estadoAuto.combustibles["Gasoil 10S"] || 66.27;
        document.getElementById('p-gasoil50').value = estadoAuto.combustibles["Gasoil 50-S"] || 57.72;
        
        // Taller
        document.getElementById('conf-taller').value = estadoAuto.nombreTaller || "";
        document.getElementById('conf-taller-dir').value = estadoAuto.direccionTaller || "";
        document.getElementById('conf-taller-tel').value = estadoAuto.telefonoTaller || "";
        
        // Selector
        document.getElementById('conf-tipo-nafta').value = estadoAuto.combustibleComparativo || "Super 95";
    }
};

window.guardarConfig = async (e) => {
    if (!user) return;
    const btn = e.target;
    const originalText = btn.innerText;
    btn.innerText = "GUARDANDO...";
    btn.disabled = true;

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

    try {
        await setDoc(doc(db, 'users', user.uid, 'config', 'general'), data, { merge: true });
        btn.innerText = "¡LISTO! ✅";
        setTimeout(() => {
            window.toggleConfig();
            btn.innerText = originalText;
            btn.disabled = false;
        }, 1000);
    } catch (err) {
        alert("Error al guardar en la nube");
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

// 4. LÓGICA DE INTERFAZ
function renderizarApp() {
    // Ahorro
    let ahorroTotal = 0;
    if (historialCargas.length > 1) {
        const ordenadas = [...historialCargas].sort((a,b) => a.km - b.km);
        const precioNafta = estadoAuto.combustibles[estadoAuto.combustibleComparativo] || 88.03;
        for(let i=1; i < ordenadas.length; i++){
            const dist = ordenadas[i].km - ordenadas[i-1].km;
            const costoEV = parseFloat(ordenadas[i].costo) || 0;
            if (dist > 0) {
                const costoNafta = (dist / estadoAuto.rendimientoAnterior) * precioNafta;
                ahorroTotal += (costoNafta - costoEV);
            }
        }
    }
    
    document.getElementById('ahorro-valor').innerText = `$ ${Math.round(ahorroTotal).toLocaleString('es-UY')}`;
    document.getElementById('user-display-name').innerText = estadoAuto.nombreUsuario || user.displayName || "Usuario";
    document.getElementById('car-display-model').innerText = estadoAuto.marcaModelo || "Telemetría Activa";

    const lista = document.getElementById('lista-cargas');
    lista.innerHTML = historialCargas.slice(0, 5).map(c => `
        <div class="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-2 flex justify-between items-center">
            <div><p class="font-bold text-zinc-200">${c.km.toLocaleString()} km</p><p class="text-[10px] text-zinc-600 uppercase">${new Date(c.fecha).toLocaleDateString()}</p></div>
            <div class="flex items-center gap-4"><p class="text-green-500 font-bold">$${(parseFloat(c.costo)||0).toFixed(0)}</p><button onclick="window.eliminarRegistro('${c.id}')" class="text-zinc-800"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>
        </div>`).join('');
    lucide.createIcons();
}

// 5. RESTO DE FUNCIONES (Login, IA, etc)
window.loginGoogle = async () => { try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); } };
window.logout = async () => { if(confirm("¿Cerrar sesión?")) { await signOut(auth); location.reload(); } };

window.registrarCarga = async (e) => {
    e.preventDefault();
    const km = parseFloat(document.getElementById('km').value) || 0;
    const batIn = parseFloat(document.getElementById('bat-inicio').value) || 0;
    const batFin = parseFloat(document.getElementById('bat-fin').value) || 0;
    const tarifa = document.getElementById('tipo-tarifa').value;
    const esCien = document.getElementById('es-cien').checked;
    const kwhTotales = ((batFin - batIn) / 100) * estadoAuto.capacidadBateria;
    const p = estadoAuto.precios;
    let costo = 0;
    if (tarifa === 'uteRapida') costo = (kwhTotales * (p.uteRapida || 10.8)) + 121.9;
    else if (tarifa === 'uteLenta') costo = (kwhTotales * (p.uteLenta || 7.54)) + 40;
    else if (tarifa === 'hogarValle') costo = (kwhTotales * (p.hogarValle || 2.32) * 1.22) + 122;
    else costo = (kwhTotales * (p.wallboxEspecial || 12) * 1.22);

    await addDoc(collection(db, 'users', user.uid, 'cargas'), { fecha: Date.now(), km, batIn, batFin, kwhTotales, costo, tarifaLabel: tarifa, esCien });
    e.target.reset();
    document.getElementById('preview-costo').innerText = "REGISTRADO ✅";
};

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

window.onload = () => { lucide.createIcons(); };
