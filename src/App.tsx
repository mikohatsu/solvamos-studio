/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Agent, DriveFolder, Message, PromptOptions, Settlement } from './types';
import Landing from './Landing';
import AppShell, { AppTab } from './AppShell';
import StudioPage from './pages/StudioPage';
import AgentsPage from './pages/AgentsPage';
import SettlementsPage from './pages/SettlementsPage';

export default function App() {
  const [view, setView] = useState<'landing' | 'studio'>(() =>
    localStorage.getItem('solvamos_entered') === '1' ||
    new URLSearchParams(window.location.search).has('drive_connected')
      ? 'studio'
      : 'landing'
  );
  const [landingBusy, setLandingBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('studio');

  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [serverStatus, setServerStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [settlements, setSettlements] = useState<Settlement[]>([
    {
      id: '5kXfD91vU8A2bN9oM9pU8vS7nN9tU8vS7nN9tU8vS7nN9',
      agentId: 'support-copilot-001',
      recipientWallet: '6xP7XpU6ZqUvS9uN8tV7nN8dM9pU8vS7nN9tU8vS7nN9',
      amount: 0.01,
      status: 'success',
      timestamp: '2026-07-21 04:22:06',
      blockHeight: 28491024,
    },
    {
      id: '3zPfS71vA2bN9oM9pU8vS7nN9tU8vS7nN9tU8vS7nN8',
      agentId: 'support-copilot-001',
      recipientWallet: '6xP7XpU6ZqUvS9uN8tV7nN8dM9pU8vS7nN9tU8vS7nN9',
      amount: 0.01,
      status: 'success',
      timestamp: '2026-07-21 03:15:42',
      blockHeight: 28490611,
    },
    {
      id: '8yQfV92wR3cN0oM8pU9vS8nO0tV8vT8nO0tV8vT8nO0t',
      agentId: 'support-copilot-001',
      recipientWallet: '6xP7XpU6ZqUvS9uN8tV7nN8dM9pU8vS7nN9tU8vS7nN9',
      amount: 0.01,
      status: 'failed',
      timestamp: '2026-07-21 02:08:12',
      blockHeight: 28489950,
    },
  ]);

  const [builderStep, setBuilderStep] = useState<1 | 2 | 3>(1);
  const [options, setOptions] = useState<PromptOptions>({
    role: 'support',
    tone: 'professional',
    securityLevel: 'strict',
    fee: 0.001,
  });
  const [agentName, setAgentName] = useState('사내 복지 안내 AI 비서');
  const [livePromptPreview, setLivePromptPreview] = useState('');
  const [creationResult, setCreationResult] = useState<any>(null);

  const [inputText, setInputText] = useState('');
  const [chatHistory, setChatHistory] = useState<Record<string, Message[]>>({});
  const [pendingPayment, setPendingPayment] = useState<{
    agentId: string;
    amount: number;
    token: string;
    recipientWallet: string;
    prompt: string;
    network?: string;
    paymentNetwork?: string;
  } | null>(null);
  const [paymentLogs, setPaymentLogs] = useState<string[]>([]);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [customSignature, setCustomSignature] = useState('');

  const [driveSessionId, setDriveSessionId] = useState<string>(
    () => localStorage.getItem('solvamos_drive_session') || ''
  );
  const [driveEmail, setDriveEmail] = useState<string | null>(null);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [driveBusy, setDriveBusy] = useState(false);
  const [tenantIdInput, setTenantIdInput] = useState('demo');

  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchStatusAndAgents = async () => {
    try {
      const statusRes = await fetch('/api/status');
      const statusData = await statusRes.json();
      setServerStatus(statusData);

      const agentsRes = await fetch('/api/agents');
      const agentsData = await agentsRes.json();
      if (agentsData.status === 'success') {
        setAgents(agentsData.data);
        if (agentsData.data.length > 0 && !activeAgent) {
          setActiveAgent(agentsData.data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to connect to backend api:', err);
    }
  };

  const refreshDriveSession = async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const res = await fetch(
        `/api/auth/google/session?session=${encodeURIComponent(sessionId)}`
      );
      const data = await res.json();
      if (data.connected) {
        setDriveEmail(data.email);
        localStorage.setItem('solvamos_drive_session', sessionId);
        setDriveSessionId(sessionId);
        const foldersRes = await fetch(
          `/api/drive/folders?session=${encodeURIComponent(sessionId)}`
        );
        const foldersData = await foldersRes.json();
        if (foldersData.status === 'success') {
          setDriveFolders(foldersData.data || []);
        }
      }
    } catch (err) {
      console.error('Drive session refresh failed', err);
    }
  };

  const connectGoogleDrive = async () => {
    setDriveBusy(true);
    try {
      const res = await fetch('/api/auth/google');
      const data = await res.json();
      if (data.status !== 'success') {
        alert(
          `${data.message || 'Google Drive auth failed'}\n\n${data.hint || ''}`
        );
        return;
      }

      localStorage.setItem('solvamos_drive_session', data.sessionId);
      setDriveSessionId(data.sessionId);

      // Local ADC PoC: no browser redirect
      if (data.mode === 'adc' || !data.authUrl) {
        localStorage.setItem('solvamos_entered', '1');
        setView('studio');
        if (data.email) setDriveEmail(data.email);
        await refreshDriveSession(data.sessionId);
        return;
      }

      window.location.href = data.authUrl;
    } catch (err) {
      console.error(err);
      alert('Failed to start Google OAuth');
    } finally {
      setDriveBusy(false);
    }
  };

  const enterWorkspace = async () => {
    setLandingBusy(true);
    try {
      if (serverStatus?.oauthConfigured || serverStatus?.driveAuthAvailable) {
        await connectGoogleDrive();
        return;
      }
      localStorage.setItem('solvamos_entered', '1');
      setView('studio');
    } finally {
      setLandingBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('solvamos_entered');
    localStorage.removeItem('solvamos_drive_session');
    setView('landing');
    setDriveSessionId('');
    setDriveEmail(null);
    setDriveFolders([]);
  };

  useEffect(() => {
    fetchStatusAndAgents();
    const params = new URLSearchParams(window.location.search);
    const sessionFromUrl = params.get('session');
    const connected = params.get('drive_connected');
    if (sessionFromUrl) {
      setDriveSessionId(sessionFromUrl);
      localStorage.setItem('solvamos_drive_session', sessionFromUrl);
      localStorage.setItem('solvamos_entered', '1');
      setView('studio');
      if (connected) {
        window.history.replaceState({}, '', '/');
      }
      refreshDriveSession(sessionFromUrl);
    } else if (driveSessionId) {
      refreshDriveSession(driveSessionId);
    }
  }, []);

  useEffect(() => {
    const fetchPreview = async () => {
      try {
        const res = await fetch('/api/agents/preview-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options),
        });
        const data = await res.json();
        setLivePromptPreview(data.systemPrompt);
      } catch (err) {
        console.error(err);
      }
    };
    fetchPreview();
  }, [options]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, activeAgent, pendingPayment]);

  const handleCreateAgent = async () => {
    setIsLoading(true);
    setBuilderStep(2);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const payload = {
        ...options,
        customRole:
          options.role === 'custom'
            ? agentName || options.customRole || '사내 HR/복지 안내'
            : options.customRole,
        googleDriveFolderId: selectedFolderId || undefined,
        tenantId: tenantIdInput || undefined,
      };
      const res = await fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.status === 'success') {
        setCreationResult(data);
        setAgents((prev) => [data.agent, ...prev]);
        setActiveAgent(data.agent);
        setBuilderStep(3);
        setActiveTab('studio');
      } else {
        alert(`Error creating agent: ${data.message}`);
        setBuilderStep(1);
      }
    } catch (err) {
      console.error(err);
      alert('Network failure compiling agent');
      setBuilderStep(1);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeAgent) return;

    const userMessage: Message = {
      id: Math.random().toString(36).substr(2, 9),
      sender: 'user',
      text: inputText,
      timestamp: new Date().toLocaleTimeString(),
    };

    const currentAgentId = activeAgent.id;
    const history = chatHistory[currentAgentId] || [];
    setChatHistory({
      ...chatHistory,
      [currentAgentId]: [...history, userMessage],
    });
    setInputText('');
    await invokeAgent(currentAgentId, userMessage.text, null);
  };

  const invokeAgent = async (
    agentId: string,
    promptText: string,
    signature: string | null
  ) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (signature) {
      headers['X-PAYMENT-PROOF'] = signature;
      setIsVerifyingPayment(true);
    } else {
      setChatHistory((prev) => ({
        ...prev,
        [agentId]: [
          ...(prev[agentId] || []),
          {
            id: 'loading-placeholder',
            sender: 'system',
            text: '⚡ Initiating secure agent-to-agent channel (pay.sh protocol handshake)...',
            timestamp: new Date().toLocaleTimeString(),
            paymentStatus: 'none',
          },
        ],
      }));
    }

    try {
      const res = await fetch(`/api/agents/${agentId}/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: promptText }),
      });
      const data = await res.json();

      setChatHistory((prev) => ({
        ...prev,
        [agentId]: (prev[agentId] || []).filter((m) => m.id !== 'loading-placeholder'),
      }));

      if (res.status === 402) {
        setPendingPayment({
          agentId,
          amount: data.amount,
          token: data.token || 'USDC',
          recipientWallet: data.recipientWallet,
          prompt: promptText,
          network: data.network,
          paymentNetwork: data.paymentNetwork,
        });

        const paywallMessage: Message = {
          id: Math.random().toString(36).substr(2, 9),
          sender: 'system',
          text: `🔒 SOLVAMOS pay.sh SECURE PAYWALL\n\nNetwork: ${data.network || data.paymentNetwork || '—'}\nFee: ${data.amount} ${data.token || 'USDC'}\nAgent vault: ${data.recipientWallet}`,
          timestamp: new Date().toLocaleTimeString(),
          paymentStatus: 'pending_proof',
        };

        setChatHistory((prev) => ({
          ...prev,
          [agentId]: [...(prev[agentId] || []), paywallMessage],
        }));
      } else if (data.status === 'success') {
        const agentResponse: Message = {
          id: Math.random().toString(36).substr(2, 9),
          sender: 'agent',
          text: data.data,
          timestamp: new Date().toLocaleTimeString(),
          confidence: data.confidence,
          paymentStatus: signature ? 'verified' : 'none',
          paymentTx: signature || undefined,
        };

        if (signature) {
          setSettlements((prev) => [
            {
              id: signature,
              agentId,
              recipientWallet: activeAgent?.publicKey || '',
              amount: pendingPayment?.amount ?? 0.01,
              status: 'success',
              timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
              blockHeight: 28491200 + Math.floor(Math.random() * 500),
            },
            ...prev,
          ]);
        }

        setChatHistory((prev) => ({
          ...prev,
          [agentId]: [...(prev[agentId] || []), agentResponse],
        }));

        if (data.paymentLogs) setPaymentLogs(data.paymentLogs);
        setPendingPayment(null);
      } else {
        const errorMessage: Message = {
          id: Math.random().toString(36).substr(2, 9),
          sender: 'system',
          text: `⚠️ Invocation Failed:\n\n${data.message || 'Unknown backend error'}`,
          timestamp: new Date().toLocaleTimeString(),
          paymentStatus: 'failed',
        };

        if (signature) {
          setSettlements((prev) => [
            {
              id: signature,
              agentId,
              recipientWallet: activeAgent?.publicKey || '',
              amount: pendingPayment?.amount ?? 0.01,
              status: 'failed',
              timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
              blockHeight: 28491200 + Math.floor(Math.random() * 500),
            },
            ...prev,
          ]);
        }

        setChatHistory((prev) => ({
          ...prev,
          [agentId]: [...(prev[agentId] || []), errorMessage],
        }));
        if (data.logs) setPaymentLogs(data.logs);
      }
    } catch (err) {
      console.error(err);
      setChatHistory((prev) => ({
        ...prev,
        [agentId]: (prev[agentId] || []).filter((m) => m.id !== 'loading-placeholder'),
      }));
      setChatHistory((prev) => ({
        ...prev,
        [agentId]: [
          ...(prev[agentId] || []),
          {
            id: Math.random().toString(36).substr(2, 9),
            sender: 'system',
            text: '⚠️ API Connection Error: Could not reach the agent endpoint.',
            timestamp: new Date().toLocaleTimeString(),
          },
        ],
      }));
    } finally {
      setIsVerifyingPayment(false);
    }
  };

  const handleAcknowledgeAndSign = async (useRandomSig = true) => {
    if (!pendingPayment) return;
    const net =
      pendingPayment.paymentNetwork || serverStatus?.paymentNetwork || 'devnet';

    let signature: string;
    if (useRandomSig) {
      const prefix =
        net === 'sandbox' ? 'PAYSH_LOCAL_' : net === 'localnet' ? 'SANDBOX_TX_' : 'MOCK_TX_';
      signature = `${prefix}${Math.random().toString(36).substr(2, 10).toUpperCase()}_${Date.now().toString().slice(-4)}`;
    } else {
      signature = customSignature.trim();
    }

    if (!signature) {
      alert('Solana / pay.sh 트랜잭션 서명을 입력하세요.');
      return;
    }

    setPaymentLogs([
      `[Network] ${net}`,
      `[Proof] ${useRandomSig ? 'Generated sandbox-style proof' : 'Pasted signature'}`,
      `Signature: ${signature}`,
      `Fee: ${pendingPayment.amount} ${pendingPayment.token}`,
    ]);

    await invokeAgent(pendingPayment.agentId, pendingPayment.prompt, signature);
    setCustomSignature('');
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const walletHint = activeAgent?.publicKey
    ? `${activeAgent.publicKey.slice(0, 4)}...${activeAgent.publicKey.slice(-4)}`
    : null;

  if (view === 'landing') {
    return (
      <Landing
        onContinue={enterWorkspace}
        oauthConfigured={!!serverStatus?.oauthConfigured}
        busy={landingBusy || driveBusy}
      />
    );
  }

  return (
    <AppShell
      activeTab={activeTab}
      onNavigate={setActiveTab}
      userEmail={driveEmail}
      walletHint={walletHint}
      onLogout={logout}
    >
      {activeTab === 'studio' && (
        <StudioPage
          options={options}
          setOptions={setOptions}
          agentName={agentName}
          setAgentName={setAgentName}
          livePromptPreview={livePromptPreview}
          isLoading={isLoading}
          builderStep={builderStep}
          creationResult={creationResult}
          onCreate={handleCreateAgent}
          driveEmail={driveEmail}
          driveFolders={driveFolders}
          selectedFolderId={selectedFolderId}
          setSelectedFolderId={setSelectedFolderId}
          driveBusy={driveBusy}
          onConnectDrive={connectGoogleDrive}
          tenantIdInput={tenantIdInput}
          setTenantIdInput={setTenantIdInput}
          activeAgent={activeAgent}
          chatHistory={chatHistory}
          inputText={inputText}
          setInputText={setInputText}
          onSendMessage={handleSendMessage}
          pendingPayment={pendingPayment}
          paymentLogs={paymentLogs}
          isVerifyingPayment={isVerifyingPayment}
          customSignature={customSignature}
          setCustomSignature={setCustomSignature}
          onAcknowledgeAndSign={handleAcknowledgeAndSign}
          bottomRef={bottomRef}
          copiedId={copiedId}
          onCopy={handleCopyText}
          serverStatus={serverStatus}
        />
      )}
      {activeTab === 'list' && (
        <AgentsPage
          agents={agents}
          onSelect={(agent) => {
            setActiveAgent(agent);
            setActiveTab('studio');
          }}
          onEdit={(agent) => {
            setActiveAgent(agent);
            setOptions({
              role: (agent.role as PromptOptions['role']) || 'support',
              customRole: agent.customRole,
              tone: (agent.tone as PromptOptions['tone']) || 'professional',
              securityLevel:
                (agent.securityLevel as PromptOptions['securityLevel']) || 'strict',
              fee: agent.fee ?? agent.perCallPriceUsdc ?? 0.001,
            });
            setAgentName(agent.customRole || '');
            setActiveTab('studio');
          }}
        />
      )}
      {activeTab === 'settlements' && (
        <SettlementsPage settlements={settlements} agents={agents} />
      )}
    </AppShell>
  );
}
