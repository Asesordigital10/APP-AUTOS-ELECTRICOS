// Asegúrate de añadir 'getDocs', 'where' y 'query' en tus importaciones de firestore al principio del archivo:
// import { ..., getDocs, where, query } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

window.preguntarIA = async () => {
    const prompt = document.getElementById('input-busqueda').value;
    const sugerencias = document.getElementById('sugerencias-manual');
    const modeloUsuario = estadoAuto.marcaModelo || "Auto Eléctrico";
    
    if (!prompt && !fotoBase64) return;

    sugerencias.innerHTML = "<p class='text-blue-500 animate-pulse text-[10px] font-black uppercase tracking-widest'>Consultando Manuales y Wiki...</p>";

    try {
        // 1. BUSCAR TODA LA INFO DEL MODELO EN FIREBASE (Segmentada)
        const conocimientoRef = collection(db, 'conocimiento_autos');
        // Filtramos para traer solo lo que pertenece al modelo del usuario
        const qManual = query(conocimientoRef, where("modelo", "==", modeloUsuario));
        const snapManual = await getDocs(qManual);
        
        let manualContexto = "INFORMACIÓN TÉCNICA DEL MANUAL:\n";
        snapManual.forEach(doc => {
            const d = doc.data();
            manualContexto += `[Categoría: ${d.categoria}]: ${d.contenido}\n`;
        });

        // 2. BUSCAR TIPS DE LA COMUNIDAD (Wiki)
        const wikiRef = collection(db, 'wiki_comunidad');
        const qWiki = query(wikiRef, where("modelo", "==", modeloUsuario));
        const snapWiki = await getDocs(qWiki);
        
        let wikiContexto = "DESCUBRIMIENTOS DE LA COMUNIDAD (WIKI):\n";
        snapWiki.forEach(doc => {
            wikiContexto += `- ${doc.data().contenido}\n`;
        });

        // 3. CONSTRUIR EL PROMPT MAESTRO PARA GEMINI
        const instruccionesIA = `
            Eres el Asistente Experto de ASYS AUTO para el modelo ${modeloUsuario}.
            
            Usa exclusivamente esta base de conocimientos para responder de forma precisa. 
            Si la información no está aquí, usa tu conocimiento general pero advierte que es una sugerencia general.
            
            ${manualContexto}
            
            ${wikiContexto}
            
            Pregunta del usuario: ${prompt}
        `;

        let partes = [instruccionesIA];
        if (fotoBase64) {
            partes.push({ inlineData: { data: fotoBase64, mimeType: "image/jpeg" } });
        }

        // 4. LLAMADA A GEMINI
        const result = await model.generateContent(partes);
        const response = await result.response;
        const text = response.text();

        // 5. RENDERIZAR RESPUESTA
        sugerencias.innerHTML = `
            <div class="bg-blue-600/10 p-5 rounded-[2rem] border border-blue-500/20 mb-4 shadow-inner">
                <p class="text-[9px] text-blue-500 font-black mb-2 uppercase italic tracking-widest">Respuesta de ASYS Intelligence</p>
                <div class="text-zinc-200 text-sm leading-relaxed">${text.replace(/\n/g, '<br>')}</div>
            </div>
            <div class="flex flex-col gap-2">
                <button onclick="window.abrirFormWiki()" class="text-[8px] text-zinc-600 uppercase font-black ml-2 hover:text-blue-400 transition-colors">
                    ¿Descubriste algo nuevo en la pantalla? Súbelo a la Wiki
                </button>
            </div>
        `;
        
        window.quitarFoto();
        document.getElementById('input-busqueda').value = "";

    } catch (error) {
        console.error(error);
        sugerencias.innerHTML = "<p class='text-red-500 text-[10px] font-bold uppercase'>Error al conectar con la base de conocimientos.</p>";
    }
};
