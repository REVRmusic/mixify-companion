import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabase";
import "./App.css";
import logoBlanc from "./assets/mixify-logo-blanc.png"; 
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

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
  
  // État pour la validation temporelle
  const [pendingTrack, setPendingTrack] = useState<{name: string, detectedAt: number} | null>(null);

  // Clé publique Supabase requise par ton API
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dmJuZmNuZ2x0a2dhZXJjeWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ2ODg5MzAsImV4cCI6MjA1MDI2NDkzMH0.UXPQPSAlYmu2kaWY3fzVnEpY32ckPzzQRCsnpdrK3Sw";

  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  // NOUVEAU : Vérification des mises à jour au démarrage
useEffect(() => {
  const checkForUpdates = async () => {
    try {
      const update = await check();
      if (update) {
        // Si une mise à jour est trouvée, on affiche une alerte au DJ
        const wantsUpdate = window.confirm(
          `Une nouvelle version de Mixify Copilot (${update.version}) est disponible !\n\nNotes de mise à jour : ${update.body}\n\nVoulez-vous l'installer maintenant ?`
        );

        if (wantsUpdate) {
          console.log(`Installation de la mise à jour ${update.version}...`);
          await update.downloadAndInstall();
          console.log("Mise à jour terminée. Redémarrage de l'application...");
          await relaunch(); // L'application redémarre toute seule avec le nouveau code !
        }
      }
    } catch (error) {
      console.error("Erreur lors de la recherche de mise à jour:", error);
    }
  };

  checkForUpdates();
}, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else setSession(data.session);
  };

  // Fonction qui récupère tes événements (Propriétaire uniquement pour l'instant)
  useEffect(() => {
    const fetchEvents = async () => {
      if (!session?.user?.id) return;
      
      setIsLoadingEvents(true);
      
      const { data, error } = await supabase
        .from('evenements')
        .select('id, name, event_status, event_type, dj_name, spotify_mode, created_at')
        .eq('owner_id', session.user.id)
        .in('event_status', ['active', 'waiting'])
        .order('created_at', { ascending: false });

      if (error) {
        setDebugError("Erreur lors de la récupération des événements : " + error.message);
      } else if (data) {
        setEvents(data);
      }
      setIsLoadingEvents(false);
    };

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
          event_id: selectedEvent?.id,
          action: 'stopped'
        })
      });
      console.log("Signal d'arrêt envoyé à Mixify");
      lastSentTrackRef.current = ""; 
    } catch (err) {
      console.error("Erreur lors de l'arrêt:", err);
    }
  };

  const toggleWatching = () => {
    if (isWatching) {
      setIsWatching(false);
      sendStopAction();
    } else {
      setIsWatching(true);
    }
  };

  // Fonction de retour aux événements
  const handleBackToEvents = () => {
    if (isWatching) {
      setIsWatching(false);
      sendStopAction();
    }
    setSelectedEvent(null);
    setScannerData(null);
    setPendingTrack(null); // On vide aussi le sas d'attente
  };

  // La boucle principale avec le sas d'attente de 15s
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
              
              // Si le morceau détecté est différent du dernier morceau ENVOYÉ
              if (rawTrackName !== lastSentTrackRef.current) {
                const now = Date.now();

                setPendingTrack(prevPending => {
                  // Scénario A : Nouveau morceau, on démarre le chrono
                  if (!prevPending || prevPending.name !== rawTrackName) {
                    console.log(`⏳ Nouveau morceau détecté en pré-écoute : ${rawTrackName}. Attente de 15s...`);
                    return { name: rawTrackName, detectedAt: now };
                  }

                  // Scénario B : Le chrono tourne. A-t-on dépassé les 15 secondes ?
                  if (now - prevPending.detectedAt >= 15000) {
                    console.log(`✅ Validation après 15s : ${rawTrackName} est considéré comme joué.`);
                    
                    lastSentTrackRef.current = rawTrackName; // On marque comme envoyé

                    let trackArtist = "Inconnu";
                    let trackTitle = rawTrackName;
                    
                    if (rawTrackName.includes(" - ")) {
                      const parts = rawTrackName.split(" - ");
                      trackArtist = parts[0].trim();
                      trackTitle = parts.slice(1).join(" - ").trim();
                    }

                    // Envoi effectif à Supabase
                    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
                      if (!currentSession) return;

                      fetch('https://qyvbnfcngltkgaercyby.supabase.co/functions/v1/companion-track-update', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${currentSession.access_token}`,
                          'apikey': SUPABASE_ANON_KEY
                        },
                        body: JSON.stringify({
                          event_id: selectedEvent?.id,
                          track_name: trackTitle,
                          track_artist: trackArtist,
                          source: 'serato',
                          action: 'playing'
                        })
                      })
                      .then(res => res.json())
                      .then(result => console.log("Réponse de Mixify :", result))
                      .catch(err => console.error("Erreur d'envoi API:", err));
                    });

                    return null; // On vide le sas d'attente
                  }

                  // Scénario C : Moins de 15s écoulées, on patiente.
                  return prevPending;
                });
              } else {
                 // Si c'est le même morceau que celui déjà validé et envoyé, on vide le sas
                 setPendingTrack(null);
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
  }, [isWatching, session, selectedEvent]);

  if (!session) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        backgroundColor: '#09090b', // Fond très sombre comme ton web
        position: 'relative', 
        overflow: 'hidden', 
        padding: 20,
        fontFamily: 'sans-serif'
      }}>
        {/* Blobs décoratifs en arrière-plan (Identiques au web) */}
        <div style={{ position: 'absolute', top: '-20%', left: '-10%', width: 500, height: 500, borderRadius: '50%', backgroundColor: 'rgba(138, 43, 226, 0.08)', filter: 'blur(80px)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-15%', right: '-10%', width: 400, height: 400, borderRadius: '50%', backgroundColor: 'rgba(88, 166, 255, 0.08)', filter: 'blur(80px)', pointerEvents: 'none' }} />
        
        <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 10 }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginBottom: 24, gap: 12 }}>
            <img src={logoBlanc} alt="Logo Mixify" style={{ height: 48, objectFit: 'contain' }} />
            <p style={{ margin: 0, fontSize: 14, color: '#a1a1aa' }}>Bon retour parmi nous 👋</p>
          </div>

          <div style={{ 
            backgroundColor: 'rgba(24, 24, 27, 0.95)', 
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: 12, 
            padding: 32,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ margin: '0 0 6px 0', fontSize: 20, color: 'white', fontWeight: 600 }}>Connexion Copilot</h2>
              <p style={{ margin: 0, fontSize: 14, color: '#a1a1aa' }}>Accédez à votre espace événement</p>
            </div>

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 14, color: '#e4e4e7', fontWeight: 500 }}>Email <span style={{ color: '#ef4444' }}>*</span></label>
                <input 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  required 
                  autoComplete="username email" // Aide pour le trousseau Mac
                  placeholder="votre@email.com" 
                  style={{ 
                    padding: '10px 12px', 
                    borderRadius: 6, 
                    border: '1px solid #3f3f46', 
                    backgroundColor: '#27272a', 
                    color: 'white', 
                    fontSize: 14, 
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }} 
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 14, color: '#e4e4e7', fontWeight: 500 }}>Mot de passe <span style={{ color: '#ef4444' }}>*</span></label>
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  required 
                  autoComplete="current-password" // Aide pour le trousseau Mac
                  placeholder="••••••••" 
                  style={{ 
                    padding: '10px 12px', 
                    borderRadius: 6, 
                    border: '1px solid #3f3f46', 
                    backgroundColor: '#27272a', 
                    color: 'white', 
                    fontSize: 14, 
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }} 
                />
              </div>

              <button 
                type="submit" 
                style={{ 
                  padding: '12px', 
                  borderRadius: 6, 
                  background: 'linear-gradient(to right, #8a2be2, #4b0082)', // Le dégradé Mixify
                  color: 'white', 
                  border: 'none', 
                  fontWeight: 500, 
                  cursor: 'pointer', 
                  marginTop: 8,
                  fontSize: 14,
                  boxShadow: '0 4px 12px rgba(138, 43, 226, 0.3)'
                }}
              >
                Se connecter
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ÉCRAN : Sélection d'événement
  if (!selectedEvent) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            <img src={logoBlanc} alt="Mixify" style={{ height: 35 }} />
            <h2 style={{ margin: 0, fontSize: 20 }}>Sélectionnez un événement</h2>
          </div>
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
                  ⚠️ Le mode Spotify est activé pour cet événement. La companion app Mixify n'est pas utilisable ici.
                </div>
              )}
            </div>
          ))
        )}
      </div>
    );
  }

  // TABLEAU DE BORD PRINCIPAL
  return (
    <div className="app-container">
      <header className="app-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <img src={logoBlanc} alt="Mixify" style={{ height: 35 }} />
          <h2 style={{ margin: 0, fontSize: 20 }}>Copilot</h2>
        </div>
        <span className="user-email">{session.user.email}</span>
      </header>
      
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
          
          {pendingTrack && (
            <div style={{ marginBottom: 15, padding: 10, backgroundColor: 'rgba(210, 153, 34, 0.2)', border: '1px solid #d29922', borderRadius: 6, color: '#e3b341', fontSize: 13 }}>
              ⏳ <strong>Pré-écoute détectée :</strong> {pendingTrack.name}<br/>
              Validation en cours (attente de 15s pour confirmer la lecture...)
            </div>
          )}

          <ul style={{ paddingLeft: 20, marginTop: 5, fontSize: 14 }}>
            {scannerData.found_tracks.map((track, index) => {
              const isLatest = index === scannerData.found_tracks.length - 1;
              const isSent = isLatest && lastSentTrackRef.current === track;
              
              return (
                <li key={index} style={{ marginBottom: 4, color: isSent ? '#2ea043' : 'white' }}>
                  {track} {isSent ? " 🟢 (Transmis à Mixify)" : ""}
                </li>
              );
            })}
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