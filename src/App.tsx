import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabase";
import "./App.css";

// On explique à TypeScript la forme exacte des données de ton événement
interface MixifyEvent {
  id: string;
  name: string;
  event_status: string;
  event_type: string;
  dj_name: string;
  spotify_mode: boolean;
}

function App() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isWatching, setIsWatching] = useState(false);
  
  const [scannerData, setScannerData] = useState<{file_name: string, found_tracks: string[]} | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);
  
  // NOUVELLES BOÎTES DE MÉMOIRE POUR LES ÉVÉNEMENTS
  const [events, setEvents] = useState<MixifyEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<MixifyEvent | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  
  const lastSentTrackRef = useRef<string>("");

  // Clé publique Supabase requise par ton API
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dmJuZmNuZ2x0a2dhZXJjeWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ2ODg5MzAsImV4cCI6MjA1MDI2NDkzMH0.UXPQPSAlYmu2kaWY3fzVnEpY32ckPzzQRCsnpdrK3Sw";

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else setSession(data.session);
  };

  // NOUVEAU : Fonction qui récupère tes événements (Propriétaire uniquement pour l'instant)
  useEffect(() => {
    const fetchEvents = async () => {
      if (!session?.user?.id) return;
      
      setIsLoadingEvents(true);
      
      // On utilise le client Supabase qui gère les tokens tout seul !
      const { data, error } = await supabase
        .from('evenements')
        .select('id, name, event_status, event_type, dj_name, spotify_mode, created_at')
        .eq('owner_id', session.user.id)
        .in('event_status', ['active', 'waiting']) // On filtre directement ici
        .order('created_at', { ascending: false });

      if (error) {
        setDebugError("Erreur lors de la récupération des événements : " + error.message);
      } else if (data) {
        setEvents(data);
      }
      setIsLoadingEvents(false);
    };

    // Dès qu'une session existe, on lance la recherche
    fetchEvents();
  }, [session]);

  // Fonction pour signaler à Mixify que le DJ a cliqué sur "Arrêter"
  const sendStopAction = async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) return;

      await fetch('https://qyvbnfcngltkgaercyby.supabase.co/functions/v1/companion-track-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession.access_token}`,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          event_id: selectedEvent?.id, // On utilise l'ID de l'événement sélectionné
          action: 'stopped'
        })
      });
      console.log("Signal d'arrêt envoyé à Mixify");
      lastSentTrackRef.current = ""; // On réinitialise la mémoire
    } catch (err) {
      console.error("Erreur lors de l'arrêt:", err);
    }
  };

  const toggleWatching = () => {
    if (isWatching) {
      setIsWatching(false);
      sendStopAction(); // On prévient Supabase qu'on s'arrête
    } else {
      setIsWatching(true);
    }
  };

  // NOUVEAU : Fonction de retour aux événements
  const handleBackToEvents = () => {
    if (isWatching) {
      setIsWatching(false);
      sendStopAction(); // Sécurité : on prévient Mixify qu'on arrête le mix
    }
    setSelectedEvent(null); // On vide la mémoire de l'événement pour réafficher la liste
    setScannerData(null); // On efface le radar pour que le prochain événement soit propre
  };

  // La boucle principale
  useEffect(() => {
    let intervalId: any;

    if (isWatching && session) {
      intervalId = setInterval(async () => {
        try {
          const data: any = await invoke("get_latest_serato_track");
          
          if (data) {
            setScannerData(data);
            setDebugError(null);
            
            if (data.found_tracks && data.found_tracks.length > 0) {
              const rawTrackName = data.found_tracks[data.found_tracks.length - 1];
              
              if (rawTrackName !== lastSentTrackRef.current) {
                lastSentTrackRef.current = rawTrackName;
                
                // 1. Découpage du nom de fichier ("Artiste - Titre")
                let trackArtist = "Inconnu";
                let trackTitle = rawTrackName;
                
                if (rawTrackName.includes(" - ")) {
                  const parts = rawTrackName.split(" - ");
                  trackArtist = parts[0].trim(); // Tout ce qui est avant le premier tiret
                  trackTitle = parts.slice(1).join(" - ").trim(); // Tout le reste
                }

                // 2. Récupération d'un token TOUJOURS valide. 
                // La librairie Supabase gère le "Refresh Token" toute seule en arrière-plan ici !
                const { data: { session: currentSession } } = await supabase.auth.getSession();
                if (!currentSession) return;

                // 3. Envoi de la requête conforme aux règles de ton API
                const response = await fetch('https://qyvbnfcngltkgaercyby.supabase.co/functions/v1/companion-track-update', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentSession.access_token}`,
                    'apikey': SUPABASE_ANON_KEY
                  },
                  body: JSON.stringify({
                    event_id: selectedEvent?.id, // On utilise l'ID de l'événement sélectionné
                    track_name: trackTitle,
                    track_artist: trackArtist,
                    source: 'serato',
                    action: 'playing' // Le champ obligatoire pour ton Edge Function !
                  })
                });

                const result = await response.json();
                console.log("Réponse de Mixify :", result);
              }
            }
          }
        } catch (error) {
          console.error("Erreur Scanner:", error);
          setDebugError(String(error));
        }
      }, 3000);
    }

    return () => clearInterval(intervalId);
  }, [isWatching, session]);

  if (!session) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif', color: 'white' }}>
        <h2>Connexion Mixify Companion</h2>
        <form onSubmit={handleLogin}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ display: 'block', marginBottom: 10, padding: 8, width: 250 }} />
          <input type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} style={{ display: 'block', marginBottom: 10, padding: 8, width: 250 }} />
          <button type="submit" style={{ padding: 8, cursor: 'pointer' }}>Se connecter</button>
        </form>
      </div>
    );
  }

  // NOUVEL ÉCRAN : Si aucun événement n'est sélectionné, on affiche la liste
  if (!selectedEvent) {
    return (
      <div className="app-container">
        <header className="app-header">
          <h2>Sélectionnez un événement 🎧</h2>
          <span className="user-email">{session.user.email}</span>
        </header>
        
        {isLoadingEvents ? (
          <p>Chargement de vos événements...</p>
        ) : events.length === 0 ? (
          <div className="card">
            <p>Aucun événement actif ou en attente trouvé.</p>
          </div>
        ) : (
          events.map((evt) => (
            <div 
              key={evt.id} 
              className="card" 
              style={{ 
                cursor: evt.spotify_mode ? 'not-allowed' : 'pointer',
                opacity: evt.spotify_mode ? 0.6 : 1,
                border: '1px solid #30363d',
                transition: 'border-color 0.2s'
              }}
              onClick={() => {
                if (!evt.spotify_mode) setSelectedEvent(evt);
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>{evt.name}</h3>
                <span style={{ 
                  padding: '4px 8px', 
                  borderRadius: 12, 
                  fontSize: 12, 
                  backgroundColor: evt.event_status === 'active' ? '#2ea043' : '#d29922',
                  color: 'white'
                }}>
                  {evt.event_status === 'active' ? '🟢 En cours' : '🟡 En attente'}
                </span>
              </div>
              <p style={{ margin: 0, color: '#8b949e', fontSize: 14 }}>
                Type: {evt.event_type} {evt.dj_name && `• DJ: ${evt.dj_name}`}
              </p>
              
              {evt.spotify_mode && (
                <div style={{ marginTop: 15, padding: 10, backgroundColor: 'rgba(218, 54, 51, 0.1)', color: '#ff7b72', borderRadius: 6, fontSize: 13 }}>
                  ⚠️ Le mode Spotify est activé pour cet événement. La companion app Serato n'est pas utilisable ici.
                </div>
              )}
            </div>
          ))
        )}
      </div>
    );
  }

  // Le tableau de bord principal
  return (
    <div className="app-container">
      <header className="app-header" style={{ marginBottom: 20 }}>
        <h2>Mixify Companion 🎧</h2>
        <span className="user-email">{session.user.email}</span>
      </header>
      
      {/* NOUVEAU : Bandeau récapitulatif de l'événement avec le bouton Retour */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#161b22', padding: '12px 20px', borderRadius: 8, border: '1px solid #30363d', marginBottom: 20 }}>
        <div>
          <span style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>ÉVÉNEMENT ACTIF</span>
          <strong style={{ fontSize: 16, color: '#58a6ff' }}>{selectedEvent.name}</strong>
        </div>
        <button 
          onClick={handleBackToEvents}
          style={{ backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, transition: 'all 0.2s' }}
        >
          Changer d'événement
        </button>
      </div>

      <div className="card status-card">
        <div>
          <span className="label">LIVE SYNC STATUS</span>
          <div className="status-indicator">
            <span className={`dot ${isWatching ? 'active' : 'inactive'}`}></span>
            <h3>{isWatching ? "SYNC ACTIVE" : "SYNC EN PAUSE"}</h3>
          </div>
        </div>
        <button 
          className={`btn-sync ${isWatching ? 'btn-stop' : 'btn-start'}`}
          onClick={toggleWatching}
        >
          {isWatching ? "ARRÊTER" : "DÉMARRER"}
        </button>
      </div>

      {scannerData && (
        <div className="card" style={{ border: '2px solid #8a2be2' }}>
          <span className="label" style={{ color: '#8a2be2', fontWeight: 'bold' }}>📡 DONNÉES ENVOYÉES À MIXIFY</span>
          <ul style={{ paddingLeft: 20, marginTop: 5, fontSize: 14 }}>
            {scannerData.found_tracks.map((track, index) => (
              <li key={index} style={{ marginBottom: 4, color: index === scannerData.found_tracks.length - 1 ? '#2ea043' : 'white' }}>
                {track} {index === scannerData.found_tracks.length - 1 ? " 🟢 (Transmis)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {debugError && (
        <div style={{ marginTop: 20, padding: 15, backgroundColor: 'rgba(218, 54, 51, 0.2)', border: '1px solid #da3633', borderRadius: 8, color: '#ff7b72', fontSize: 14 }}>
          <strong>Erreur :</strong> {debugError}
        </div>
      )}
    </div>
  );
}

export default App;