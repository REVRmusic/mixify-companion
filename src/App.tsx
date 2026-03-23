import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { supabase } from "./supabase";
import "./App.css";
import logoBlanc from "./assets/mixify-logo-blanc.png";
import seratoLogo from "./assets/serato-logo.png";
import rekordboxLogo from "./assets/rekordbox-logo.png";
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

  const [scannerData, setScannerData] = useState<{ file_name: string, found_tracks: string[] } | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);

  const [djSoftware, setDjSoftware] = useState<"serato" | "rekordbox" | null>(null);
  const [avatarError, setAvatarError] = useState(false);

  // NOUVELLES BOÎTES DE MÉMOIRE POUR LES ÉVÉNEMENTS
  const [events, setEvents] = useState<MixifyEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<MixifyEvent | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [, setTick] = useState(0);
  const [syncDelay, setSyncDelay] = useState<number>(22000);

  const lastSentTrackRef = useRef<string>("");

  // État pour la validation temporelle
  const [pendingTrack, setPendingTrack] = useState<{ name: string, detectedAt: number } | null>(null);

  // SYSTÈME DE MISE À JOUR
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Clé publique Supabase requise par ton API
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dmJuZmNuZ2x0a2dhZXJjeWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ2ODg5MzAsImV4cCI6MjA1MDI2NDkzMH0.UXPQPSAlYmu2kaWY3fzVnEpY32ckPzzQRCsnpdrK3Sw";


  useEffect(() => {
    // 1. On vérifie s'il y a une session immédiatement au démarrage
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // 2. NOUVEAU : On installe un "écouteur" qui guette la réponse retardée de Supabase
    // Si Supabase retrouve la session en arrière-plan, il déclenche cet événement
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session); // On met à jour l'interface en direct
      }
    );

    // 3. On débranche proprement l'écouteur quand on quitte l'application (bonne pratique)
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // On force l'application à se rafraîchir toutes le secondes pour le compte à rebours
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // GESTIONNAIRE CENTRAL DES MISES À JOUR (Démarrage + Menu Apple)
  useEffect(() => {
    // 1. Fonction sécurisée (sans alert)
    const checkForUpdates = async (isManual: boolean) => {
      try {
        const update = await check();
        if (update) {
          setUpdateInfo(update); // Déclenche notre belle modale Mixify
        } else if (isManual) {
          setUpdateMessage("Mixify Copilot est déjà à jour !");
          setTimeout(() => setUpdateMessage(null), 4000);
        }
      } catch (error: any) {
        console.error("Erreur de maj détaillée :", error);
        
        if (isManual) {
          // LE SÉRUM DE VÉRITÉ : On va lire manuellement le fichier pour voir ce qu'il contient
          fetch("https://raw.githubusercontent.com/REVRmusic/mixify-companion/main/update.json?force=" + Date.now())
            .then(res => res.text())
            .then(text => {
              console.log("📄 Contenu brut du fichier vu par l'application :", text);
              
              if (!text.includes("darwin-aarch64")) {
                setUpdateMessage("🚨 C'est le cache ! L'app lit toujours l'ancien fichier sans 'darwin-aarch64'.");
              } else if (!text.includes('"version": "0.1.6"')) {
                setUpdateMessage("⚠️ Le fichier a la bonne plateforme, mais la version n'est pas 0.1.6 !");
              } else {
                setUpdateMessage(`Mystère Tauri : ${String(error)}`);
              }
            })
            .catch(() => setUpdateMessage(`Erreur réseau / système : ${String(error)}`));

          setTimeout(() => setUpdateMessage(null), 8000);
        }
      }
    };

    // 2. Vérification invisible au démarrage
    checkForUpdates(false);

    // 3. Écouteur pour le clic dans la barre des menus Apple
    const unlistenPromise = listen('trigger-update-check', () => {
      checkForUpdates(true);
    });

    // 4. Nettoyage parfait
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
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
          action: 'stopped',
          track_name: "",    // On vide explicitement le nom pour le web
          track_artist: ""   // On vide explicitement l'artiste pour le web
        })
      });
      console.log("Signal d'arrêt envoyé à Mixify (affichage coupé)");
      lastSentTrackRef.current = "";
    } catch (err) {
      console.error("Erreur lors de l'arrêt:", err);
    }
  };

  const toggleWatching = () => {
    if (isWatching) {
      setIsWatching(false);
      sendStopAction();
      setPendingTrack(null); // On vide le morceau en attente de validation
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

  // La boucle principale avec le sas d'attente de 22s
  useEffect(() => {
    let intervalId: any;

    // MODIFICATION : On écoute en permanence dès qu'un événement est sélectionné et qu'on est connecté.
    if (session && selectedEvent) {
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
                    console.log(`⏳ Nouveau morceau détecté en pré-écoute : ${rawTrackName}. Attente de ${syncDelay / 1000}s...`);
                    return { name: rawTrackName, detectedAt: now };
                  }

                  // Scénario B : Le chrono tourne. A-t-on dépassé le délai choisi ?
                  if (now - prevPending.detectedAt >= syncDelay) {
                    
                    // NOUVELLE LOGIQUE : On ne valide et on n'envoie le morceau QUE si la SYNC est active
                    if (isWatching) {
                      console.log(`✅ Validation et envoi : ${rawTrackName} part vers Mixify.`);
                      lastSentTrackRef.current = rawTrackName; // On marque comme envoyé SEULEMENT SI on le transmet vraiment

                      let trackArtist = "Inconnu";
                      let trackTitle = rawTrackName;

                      if (rawTrackName.includes(" - ")) {
                        const parts = rawTrackName.split(" - ");
                        trackArtist = parts[0].trim();
                        trackTitle = parts.slice(1).join(" - ").trim();
                      }

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
                            source: djSoftware,
                            action: 'playing'
                          })
                        })
                        .then(res => res.json())
                        .then(result => console.log("Réponse de Mixify :", result))
                        .catch(err => console.error("Erreur d'envoi API:", err));
                      });

                      return null; // On vide le sas d'attente car le morceau est bien parti
                      
                    } else {
                      // SI LA SYNC EST EN PAUSE : 
                      // On ne fait rien ! On renvoie l'état actuel pour garder le morceau "sous le coude".
                      // Dès que tu cliqueras sur DÉMARRER, isWatching deviendra "true" et le morceau partira instantanément au prochain cycle (dans max 3s).
                      console.log("⏸️ Morceau prêt (22s écoulées), en attente du clic sur DÉMARRER...");
                      return prevPending; 
                    }
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
  }, [isWatching, session, selectedEvent, syncDelay]);

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

  // NOUVEL ÉCRAN : Sélection du logiciel DJ
  if (!djSoftware) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            <img src={logoBlanc} alt="Mixify" style={{ height: 35 }} />
            <h2 style={{ margin: 0, fontSize: 20 }}>Configuration</h2>
          </div>
          
          {/* LE NOUVEAU BLOC D'AVATAR EST ICI */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="user-email">{session.user.email}</span>
            {session.user.user_metadata?.avatar_url && session.user.user_metadata.avatar_url.startsWith('http') && !avatarError ? (
              <img 
                src={session.user.user_metadata.avatar_url} 
                alt="Profil" 
                style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid #30363d' }} 
                onError={() => setAvatarError(true)}
              />
            ) : (
              <div style={{ 
                width: 32, 
                height: 32, 
                borderRadius: '50%', 
                background: 'linear-gradient(135deg, #8a2be2, #4b0082)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                color: 'white', 
                fontWeight: 'bold', 
                fontSize: 14, 
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
              }}>
                {session.user.email.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          {/* FIN DU NOUVEAU BLOC */}

        </header>

        <div style={{ textAlign: 'center', marginTop: 40, marginBottom: 30 }}>
          <h3 style={{ color: 'white', fontSize: 24, marginBottom: 10 }}>Quel logiciel utilisez-vous ce soir ?</h3>
          <p style={{ color: '#a1a1aa', fontSize: 14 }}>Mixify adaptera sa synchronisation en fonction de votre régie.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 600, margin: '0 auto' }}>
          {/* Bouton Serato */}
          <div
            onClick={() => setDjSoftware('serato')}
            className="card software-card"
            style={{ cursor: 'pointer', textAlign: 'center', padding: '30px 20px', border: '1px solid #30363d', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 15 }}
          >
            <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={seratoLogo} alt="Serato" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <h3 style={{ margin: 0, color: 'white' }}>Serato DJ</h3>
            <p style={{ margin: 0, fontSize: 12, color: '#8b949e' }}>Lecture via fichier Log</p>
          </div>

          {/* Bouton Rekordbox (Mode Bientôt) */}
          <div
            onClick={() => alert("L'intégration Rekordbox est en cours de développement ! Pioneer ayant un écosystème très fermé, nous finalisons une solution sur-mesure pour vous. À très vite ! 🚀")}
            className="card software-card"
            style={{
              cursor: 'not-allowed',
              textAlign: 'center',
              padding: '30px 20px',
              border: '1px solid #30363d',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 15,
              opacity: 0.6,
              position: 'relative',
              backgroundColor: 'rgba(255, 0, 0, 0.05)'
            }}
          >
            {/* Petit badge BIENTÔT */}
            <div style={{ position: 'absolute', top: 12, right: 12, backgroundColor: '#ff3333', color: 'white', fontSize: 10, padding: '4px 8px', borderRadius: 12, fontWeight: 'bold', letterSpacing: 1 }}>
              BIENTÔT
            </div>

            <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', filter: 'grayscale(100%)' }}>
              <img src={rekordboxLogo} alt="Rekordbox" style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.7 }} />
            </div>
            <h3 style={{ margin: 0, color: 'white' }}>Rekordbox</h3>
            <p style={{ margin: 0, fontSize: 12, color: '#8b949e' }}>En cours de développement...</p>
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
            <h2 style={{ margin: 0, fontSize: 20 }}>Événements</h2>
          </div>
          {/* Bouton de retour au choix du logiciel */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 10, color: '#8b949e', display: 'block', textTransform: 'uppercase' }}>Logiciel</span>
              <span style={{ fontSize: 13, color: 'white', fontWeight: 'bold' }}>
                {djSoftware === 'serato' ? 'Serato DJ' : 'Rekordbox'}
              </span>
            </div>
            <button
              onClick={() => setDjSoftware(null)}
              style={{
                backgroundColor: '#21262d',
                border: '1px solid #30363d',
                color: '#58a6ff',
                padding: '5px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              Changer
            </button>
          </div>
        </header>

        {/* Reste du code des événements (isLoadingEvents, etc.) */}

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="user-email">{session.user.email}</span>
          {session.user.user_metadata?.avatar_url && session.user.user_metadata.avatar_url.startsWith('http') && !avatarError ? (
            <img 
              src={session.user.user_metadata.avatar_url} 
              alt="Profil" 
              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid #30363d' }} 
              onError={() => setAvatarError(true)} // LA MAGIE EST ICI
            />
          ) : (
            <div style={{ 
              width: 32, 
              height: 32, 
              borderRadius: '50%', 
              background: 'linear-gradient(135deg, #8a2be2, #4b0082)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              color: 'white', 
              fontWeight: 'bold', 
              fontSize: 14, 
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}>
              {session.user.email.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
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

      {/* SECTION : AFFICHAGE DU MORCEAU EN COURS AVEC COMPTEUR REBOURS */}
      <div style={{ backgroundColor: '#1c1c1e', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 15, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
        <div style={{ position: 'relative', minWidth: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(135deg, #00adef, #8a2be2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: '0 0 15px rgba(138, 43, 226, 0.3)' }}>
          🎵
          {/* PETIT BADGE COMPTEUR (S'affiche uniquement si un morceau est en attente) */}
          {pendingTrack && (
            <div style={{
              position: 'absolute',
              top: -5,
              right: -5,
              backgroundColor: '#ff3333',
              color: 'white',
              fontSize: 10,
              width: 20,
              height: 20,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              border: '2px solid #1c1c1e'
            }}>
              {Math.max(0, Math.ceil((syncDelay - (Date.now() - pendingTrack.detectedAt)) / 1000))}
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
              Actuellement sur les platines
            </span>
            {pendingTrack && (
              <span style={{ fontSize: 10, color: '#00adef', fontWeight: 'bold', fontStyle: 'italic' }}>
                VALIDATION EN COURS...
              </span>
            )}
          </div>
          <strong style={{ fontSize: 16, color: 'white', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {scannerData && scannerData.found_tracks && scannerData.found_tracks.length > 0 
              ? scannerData.found_tracks[scannerData.found_tracks.length - 1] 
              : "En attente de musique..."}
          </strong>
        </div>
      </div>

      <div className="card status-card" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        {/* LIGNE 1 : Statut et Bouton Démarrer/Arrêter */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
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

        {/* LIGNE 2 : Sélecteur de vitesse de mix */}
        <div style={{ width: '100%', borderTop: '1px solid #30363d', paddingTop: 15 }}>
          <span style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
            Délai de validation du mix
          </span>
          <div style={{ display: 'flex', backgroundColor: '#09090b', borderRadius: 8, padding: 4, border: '1px solid #30363d', gap: 4 }}>
            <button 
              onClick={() => setSyncDelay(10000)} 
              style={{ flex: 1, padding: '8px 0', fontSize: 12, borderRadius: 6, backgroundColor: syncDelay === 10000 ? '#3f3f46' : 'transparent', color: syncDelay === 10000 ? 'white' : '#8b949e', border: 'none', cursor: 'pointer', transition: 'all 0.2s', fontWeight: syncDelay === 10000 ? 'bold' : 'normal' }}
            >
              ⚡️ 10s (Rapide)
            </button>
            <button 
              onClick={() => setSyncDelay(15000)} 
              style={{ flex: 1, padding: '8px 0', fontSize: 12, borderRadius: 6, backgroundColor: syncDelay === 15000 ? '#3f3f46' : 'transparent', color: syncDelay === 15000 ? 'white' : '#8b949e', border: 'none', cursor: 'pointer', transition: 'all 0.2s', fontWeight: syncDelay === 15000 ? 'bold' : 'normal' }}
            >
              🎵 15s (Normal)
            </button>
            <button 
              onClick={() => setSyncDelay(22000)} 
              style={{ flex: 1, padding: '8px 0', fontSize: 12, borderRadius: 6, backgroundColor: syncDelay === 22000 ? '#3f3f46' : 'transparent', color: syncDelay === 22000 ? 'white' : '#8b949e', border: 'none', cursor: 'pointer', transition: 'all 0.2s', fontWeight: syncDelay === 22000 ? 'bold' : 'normal' }}
            >
              🐢 22s (Long)
            </button>
          </div>
        </div>
      </div>

      {/* MODIFICATION : On ajoute "isWatching &&" pour cacher la boîte quand c'est en pause */}
      {isWatching && scannerData && (
        <div className="card" style={{ border: '2px solid #8a2be2' }}>
          <span className="label" style={{ color: '#8a2be2', fontWeight: 'bold' }}>📡 DERNIÈRES DONNÉES ENVOYÉES À MIXIFY</span>
          
          {pendingTrack && (
            <div style={{ marginBottom: 15, padding: 10, backgroundColor: 'rgba(210, 153, 34, 0.2)', border: '1px solid #d29922', borderRadius: 6, color: '#e3b341', fontSize: 13 }}>
              ⏳ <strong>Pré-écoute détectée :</strong> {pendingTrack.name}<br/>
              Validation en cours (attente de {syncDelay / 1000}s pour confirmer la lecture...)
            </div>
          )}

          <ul style={{ paddingLeft: 20, marginTop: 5, fontSize: 14 }}>
            {/* On découpe la liste avec .slice(-5) pour ne garder que les 5 derniers morceaux */}
            {scannerData.found_tracks.slice(-5).map((track, index, tableauReduit) => {
              // On cherche le dernier morceau de ce nouveau tableau de 5
              const isLatest = index === tableauReduit.length - 1;
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
      {/* --- SYSTÈME DE MISE À JOUR (INTERFACE VISUELLE) --- */}
      {updateMessage && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', backgroundColor: '#2ea043', color: 'white', padding: '10px 20px', borderRadius: 8, zIndex: 9999, fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)' }}>
          {updateMessage}
        </div>
      )}

      {updateInfo && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#18181b', padding: 32, borderRadius: 16, border: '1px solid #8a2be2', maxWidth: 400, textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🚀</div>
            <h3 style={{ margin: '0 0 8px 0', color: 'white', fontSize: 20 }}>Mise à jour disponible</h3>
            <p style={{ margin: 0, color: '#a1a1aa', fontSize: 14 }}>La version <strong>{updateInfo.version}</strong> de Mixify Copilot est prête à être installée.</p>
            
            {updateInfo.body && (
              <div style={{ margin: '20px 0', padding: 12, backgroundColor: '#27272a', borderRadius: 8, fontSize: 13, color: '#d4d4d8', textAlign: 'left', border: '1px solid #3f3f46' }}>
                <strong>Nouveautés :</strong><br/>{updateInfo.body}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button 
                onClick={() => setUpdateInfo(null)} 
                disabled={isUpdating}
                style={{ flex: 1, padding: '10px', borderRadius: 8, backgroundColor: 'transparent', border: '1px solid #52525b', color: '#e4e4e7', cursor: isUpdating ? 'not-allowed' : 'pointer', fontWeight: 500 }}
              >
                Plus tard
              </button>
              <button 
                onClick={async () => {
                  setIsUpdating(true);
                  try {
                    await updateInfo.downloadAndInstall();
                    await relaunch();
                  } catch (e) {
                    console.error(e);
                    setIsUpdating(false);
                    setUpdateInfo(null);
                  }
                }} 
                disabled={isUpdating}
                style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'linear-gradient(to right, #8a2be2, #4b0082)', border: 'none', color: 'white', cursor: isUpdating ? 'wait' : 'pointer', fontWeight: 500, boxShadow: '0 4px 12px rgba(138, 43, 226, 0.3)' }}
              >
                {isUpdating ? "Installation..." : "Installer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;