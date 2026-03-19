import React, { useState, useEffect } from 'react';
import { Mail, MessageCircle, Linkedin, CheckCircle, AlertCircle, Loader, ExternalLink, X as XIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const SERVER = 'http://localhost:3001';

const INTEGRATIONS = [
  {
    key: 'email',
    label: 'Gmail',
    icon: Mail,
    iconColor: 'text-red-400',
    description: 'Read and score emails. LinkedIn notification emails are also parsed automatically.',
    connectPath: '/integrations/gmail/connect',
    canDisconnect: true,
    setupSteps: null
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    iconColor: 'text-green-400',
    description: 'Receive and score WhatsApp messages. Sentinel auto-replies during focus sessions.',
    connectPath: null,
    canDisconnect: false,
    setupSteps: [
      'Go to developers.facebook.com → Create App → Business type',
      'Add the WhatsApp product and get a test phone number',
      'Generate a permanent System User token in Business Settings',
      'Set webhook URL to: https://your-server/integrations/whatsapp/webhook',
      'Subscribe to: messages, message_status',
      'Add to server/.env: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET'
    ]
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    icon: Linkedin,
    iconColor: 'text-blue-400',
    description: 'LinkedIn notifications are detected automatically from Gmail. No separate connection needed.',
    connectPath: null,
    canDisconnect: false,
    setupSteps: null
  }
];

const IntegrationSetup = ({ onClose }) => {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState({});
  const [expandedSetup, setExpandedSetup] = useState({});

  const loadStatuses = () => {
    fetch(`${SERVER}/integrations/${user.id}`)
      .then(r => r.json())
      .then(data => {
        const map = {};
        data.forEach(i => { map[i.integration_type] = i; });
        setStatuses(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadStatuses(); }, [user.id]);

  const handleConnect = (integration) => {
    if (!integration.connectPath) return;
    window.location.href = `${SERVER}${integration.connectPath}?user_id=${user.id}`;
  };

  const handleDisconnect = async (key) => {
    setDisconnecting(prev => ({ ...prev, [key]: true }));
    try {
      await fetch(`${SERVER}/integrations/${user.id}/${key}`, { method: 'DELETE' });
      setStatuses(prev => ({
        ...prev,
        [key]: { ...prev[key], status: 'disconnected', is_enabled: false }
      }));
    } catch (e) {
      console.error('Disconnect failed:', e);
    }
    setDisconnecting(prev => ({ ...prev, [key]: false }));
  };

  const toggleSetup = (key) => setExpandedSetup(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-panel border border-hover rounded-lg w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-hover flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="font-mono font-bold text-primaryText tracking-wider">CONNECT APPS</h2>
            <p className="text-xs text-tertiaryText font-mono mt-1">Sentinel monitors these sources during focus sessions</p>
          </div>
          <button onClick={onClose} className="text-tertiaryText hover:text-primaryText transition-colors p-1">
            <XIcon size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto hide-scrollbar flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-tertiaryText font-mono">
              <Loader size={20} className="animate-spin mr-2" /> Loading...
            </div>
          ) : (
            INTEGRATIONS.map(integration => {
              const status = statuses[integration.key];
              const isConnected = status?.status === 'connected' && status?.is_enabled !== false;
              // LinkedIn is "active" when Gmail is connected — no separate auth needed
              const isLinkedInActiveViaGmail =
                integration.key === 'linkedin' &&
                statuses['email']?.status === 'connected' &&
                statuses['email']?.is_enabled !== false;
              const Icon = integration.icon;
              const showSetup = expandedSetup[integration.key];

              return (
                <div key={integration.key} className={`bg-base rounded border p-4 transition-colors ${isConnected || isLinkedInActiveViaGmail ? 'border-teal-500/30' : 'border-hover'}`}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-hover flex-shrink-0">
                      <Icon size={20} className={integration.iconColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-mono font-bold text-sm text-primaryText">{integration.label}</h3>
                        {isConnected ? (
                          <span className="flex items-center gap-1 text-xs font-mono text-success">
                            <CheckCircle size={12} /> Connected
                          </span>
                        ) : isLinkedInActiveViaGmail ? (
                          <span className="flex items-center gap-1 text-xs font-mono text-teal-400">
                            <CheckCircle size={12} /> Active via Gmail
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-mono text-tertiaryText">
                            <AlertCircle size={12} /> Not connected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-secondaryText font-mono mt-1">{integration.description}</p>
                      {isConnected && status?.last_synced_at && (
                        <p className="text-[10px] text-tertiaryText font-mono mt-1">
                          Last synced: {new Date(status.last_synced_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action buttons row */}
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {!isConnected && integration.connectPath && (
                      <button
                        onClick={() => handleConnect(integration)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded font-mono text-xs hover:bg-teal-500/30 transition-all"
                      >
                        <ExternalLink size={11} /> Connect via Google
                      </button>
                    )}
                    {isConnected && integration.canDisconnect && (
                      <button
                        onClick={() => handleDisconnect(integration.key)}
                        disabled={disconnecting[integration.key]}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-critical/10 text-critical border border-critical/20 rounded font-mono text-xs hover:bg-critical/20 transition-all disabled:opacity-50"
                      >
                        {disconnecting[integration.key] ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    )}
                    {!isConnected && integration.setupSteps && (
                      <button
                        onClick={() => toggleSetup(integration.key)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-hover text-secondaryText rounded font-mono text-xs hover:text-primaryText transition-colors"
                      >
                        Setup guide {showSetup ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                    )}
                  </div>

                  {/* Setup steps */}
                  {showSetup && integration.setupSteps && (
                    <ol className="mt-3 space-y-1.5 pl-1">
                      {integration.setupSteps.map((step, i) => (
                        <li key={i} className="flex gap-2 text-[11px] font-mono text-tertiaryText">
                          <span className="text-teal-600 font-bold shrink-0">{i + 1}.</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-5 border-t border-hover flex-shrink-0">
          <p className="text-xs text-tertiaryText font-mono text-center">
            Sentinel only reads notification metadata. Message content is never stored in plaintext.
          </p>
        </div>
      </div>
    </div>
  );
};

export default IntegrationSetup;
