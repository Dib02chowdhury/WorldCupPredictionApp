const STORAGE_KEY = 'worldcup-pulse-state-v1';
const API_URL = window.GOOGLE_APPS_SCRIPT_URL || '';
const defaultState = {
  sessionUser: null,
  users: [],
  matches: [],
  predictions: [],
  specialQuestions: [],
  specialQuestionResponses: [],
  pointSettings: { participationPoints: 1, correctResultPoints: 2, exactScorePoints: 3, specialQuestionPoints: 1 },
  leaderboard: []
};

let state = loadState();
let currentView = 'home';
let authMode = 'login';

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaultState, ...parsed, users: parsed.users || defaultState.users, matches: parsed.matches || defaultState.matches, predictions: parsed.predictions || defaultState.predictions, specialQuestions: parsed.specialQuestions || defaultState.specialQuestions, specialQuestionResponses: parsed.specialQuestionResponses || defaultState.specialQuestionResponses };
    }
  } catch (error) {
    console.warn('State could not be loaded', error);
  }
  return structuredClone(defaultState);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function mergeRemoteState(payload) {
  state = {
    ...state,
    users: Array.isArray(payload.users) && payload.users.length ? payload.users : state.users,
    matches: Array.isArray(payload.matches) ? payload.matches : state.matches,
    predictions: Array.isArray(payload.predictions) ? payload.predictions : state.predictions,
    specialQuestions: Array.isArray(payload.specialQuestions) ? payload.specialQuestions : state.specialQuestions,
    specialQuestionResponses: Array.isArray(payload.specialQuestionResponses) ? payload.specialQuestionResponses : state.specialQuestionResponses,
    pointSettings: payload.pointSettings || state.pointSettings || defaultState.pointSettings
  };
  if (!state.users.length) {
    state.users = [];
  }
  if (state.sessionUser) {
    const currentUser = state.users.find((user) => user.username === state.sessionUser.username);
    if (currentUser) {
      state.sessionUser = { username: currentUser.username, role: currentUser.role };
    }
  }
  saveState();
  renderAll();
}

function buildQueryString(params) {
  return Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

function jsonpRequest(url, params) {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonpCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    params.callback = callbackName;
    const script = document.createElement('script');
    script.src = `${url}?${buildQueryString(params)}`;
    script.async = true;
    let timeoutId = null;

    window[callbackName] = (data) => {
      clearTimeout(timeoutId);
      delete window[callbackName];
      document.body.removeChild(script);
      resolve(data);
    };

    script.onerror = () => {
      clearTimeout(timeoutId);
      delete window[callbackName];
      if (script.parentNode) document.body.removeChild(script);
      reject(new Error('JSONP request failed'));
    };

    timeoutId = setTimeout(() => {
      delete window[callbackName];
      if (script.parentNode) document.body.removeChild(script);
      reject(new Error('JSONP request timed out'));
    }, 15000);

    document.body.appendChild(script);
  });
}

async function loadRemoteState(showNotice = false) {
  if (!API_URL) {
    showToast('Apps Script URL is not configured yet.');
    return false;
  }
  try {
    const payload = await jsonpRequest(API_URL, { action: 'getData' });
    if (payload && typeof payload === 'object' && Array.isArray(payload.matches)) {
      mergeRemoteState(payload);
      if (showNotice) {
        showToast('Loaded latest sheet data.');
      }
      return true;
    }
  } catch (error) {
    console.warn('Remote sync failed', error);
  }
  return false;
}

async function syncToBackend(action, payload) {
  if (!API_URL) return;
  try {
    await jsonpRequest(API_URL, { action, payload: JSON.stringify(payload) });
  } catch (error) {
    console.warn('Backend sync failed', error);
  }
}

async function syncAndRefresh(action, payload) {
  await syncToBackend(action, payload);
  await loadRemoteState();
}

function showToast(message) {
  const toastContainer = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}

function getCurrentUser() {
  return state.sessionUser ? state.users.find((user) => user.username === state.sessionUser.username) || null : null;
}

function updateAuthButton() {
  const authButton = document.getElementById('authButton');
  const adminButton = document.getElementById('adminButton');
  const user = getCurrentUser();
  if (user) {
    authButton.textContent = 'Logout';
    if (adminButton) {
      adminButton.hidden = user.role !== 'admin';
    }
  } else {
    authButton.textContent = 'Login';
    if (adminButton) {
      adminButton.hidden = true;
    }
  }
}

function logoutUser() {
  state.sessionUser = null;
  saveState();
  updateAuthButton();
  showToast('You have been logged out.');
  renderAll();
  closeAuthModal();
}

function getPointSettings() {
  return state.pointSettings || defaultState.pointSettings;
}

function renderHome() {
  document.getElementById('homePlayers').textContent = state.users.filter((u) => u.role === 'user').length + 1;
  document.getElementById('homeMatches').textContent = state.matches.length;
  document.getElementById('homePredictions').textContent = state.predictions.length;

  const nextMatch = state.matches.find((match) => match.status === 'upcoming') || state.matches[0];
  if (nextMatch) {
    document.getElementById('nextMatchTitle').textContent = `${nextMatch.teamA} vs ${nextMatch.teamB}`;
    document.getElementById('nextMatchMeta').textContent = `${nextMatch.tournament} • Match #${nextMatch.matchNumber} • ${formatDate(nextMatch.kickoffDateTime)}`;
  } else {
    document.getElementById('nextMatchTitle').textContent = 'No match created yet';
    document.getElementById('nextMatchMeta').textContent = 'Admin can add the next fixture from the dashboard.';
  }

  const question = state.specialQuestions.find((item) => item.status === 'active') || state.specialQuestions[0];
  if (question) {
    document.getElementById('questionTitle').textContent = question.question;
    document.getElementById('questionMeta').textContent = `Deadline: ${formatDate(question.deadline)} • ${question.points} point`;
  } else {
    document.getElementById('questionTitle').textContent = 'No active special question';
    document.getElementById('questionMeta').textContent = 'Admin can add a question for users to answer.';
  }

  renderLeaderboardPreview();
  renderResults();
  updateCountdown();
}

function renderLeaderboardPreview() {
  const preview = document.getElementById('leaderboardPreview');
  const leaderboard = buildLeaderboard();
  preview.innerHTML = leaderboard.slice(0, 5).map((entry, index) => {
    const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
    return `
      <div class="leaderboard-row">
        <div class="d-flex align-items-center gap-2">
          <div class="rank-badge ${rankClass}">${index + 1}</div>
          <div>
            <strong>${entry.username}</strong>
            <div class="meta-text">${entry.totalPoints} pts</div>
          </div>
        </div>
        <span class="status-chip">${entry.totalPoints} pts</span>
      </div>`;
  }).join('');
}

function renderResults() {
  const results = document.getElementById('latestResults');
  const completed = state.matches.filter((match) => match.status === 'completed').slice(-3).reverse();
  if (!completed.length) {
    results.innerHTML = '<div class="empty-state">Results will appear here after admin publishes the score.</div>';
    return;
  }
  results.innerHTML = completed.map((match) => `
    <div class="match-card">
      <div class="card-header">
        <p class="eyebrow">Match #${match.matchNumber}</p>
        <span class="status-chip live">Final</span>
      </div>
      <h4>${match.teamA} ${match.finalScoreA} - ${match.finalScoreB} ${match.teamB}</h4>
      <p class="meta-text">${match.tournament}</p>
    </div>`).join('');
}

function renderMatches() {
  const container = document.getElementById('matchesList');
  if (!state.matches.length) {
    container.innerHTML = '<div class="empty-state">No matches yet.</div>';
    return;
  }
  container.innerHTML = state.matches.map((match) => {
    const isLocked = isPredictionLocked(match);
    const userPrediction = getPredictionForMatch(match.matchNumber);
    const countdown = getCountdownText(match.kickoffDateTime);
    const activeQuestion = state.specialQuestions.find((item) => item.status === 'active') || state.specialQuestions[0];
    return `
      <article class="match-card">
        <div class="card-header">
          <p class="eyebrow">Match #${match.matchNumber}</p>
          <span class="status-chip ${isLocked ? '' : 'live'}">${isLocked ? 'Locked' : 'Open'}</span>
        </div>
        <h4>${match.teamA} <span class="meta-text">vs</span> ${match.teamB}</h4>
        <p class="meta-text">${match.tournament}</p>
        <p class="meta-text">Kickoff: ${formatDate(match.kickoffDateTime)}</p>
        <div class="countdown">${countdown}</div>
        <div class="match-score">
          <div>
            <strong>Your Pick</strong>
            <div class="meta-text">${userPrediction ? `${userPrediction.predictionA}-${userPrediction.predictionB}` : 'Not predicted yet'}</div>
            <div class="meta-text">${userPrediction ? `Last saved: ${formatSavedTime(userPrediction.timestamp)}` : 'Save your prediction to track the timestamp.'}</div>
          </div>
          <div class="score-pill">${isLocked ? 'Prediction Closed' : 'Predict Now'}</div>
        </div>
        ${activeQuestion ? `<div class="special-question-block"><p class="eyebrow">Special Question</p><strong>${activeQuestion.question}</strong><p class="meta-text">Submit your answer before ${formatDate(activeQuestion.deadline)}</p><form class="compact-form inline-question-form" data-question-id="${activeQuestion.id}"><input type="number" name="specialAnswer" placeholder="Your answer" /><button class="primary-btn" type="submit">Submit</button></form></div>` : ''}
        <form class="compact-form prediction-form" data-match-id="${match.id}">
          <input type="number" name="predictionA" min="0" max="20" placeholder="${match.teamA}" value="${userPrediction ? userPrediction.predictionA : ''}" ${isLocked ? 'disabled' : ''} />
          <input type="number" name="predictionB" min="0" max="20" placeholder="${match.teamB}" value="${userPrediction ? userPrediction.predictionB : ''}" ${isLocked ? 'disabled' : ''} />
          <button class="primary-btn" type="submit" ${isLocked ? 'disabled' : ''}>Save</button>
        </form>
      </article>`;
  }).join('');
}

function renderMyPredictions() {
  const container = document.getElementById('myPredictionsList');
  const user = getCurrentUser();
  if (!user) {
    container.innerHTML = '<div class="empty-state">Sign in to see your predictions.</div>';
    return;
  }
  const preds = state.predictions.filter((p) => p.username === user.username);
  if (!preds.length) {
    container.innerHTML = '<div class="empty-state">You have not submitted any predictions yet.</div>';
    return;
  }
  container.innerHTML = preds.map((pred) => {
    const match = state.matches.find((item) => item.matchNumber === pred.matchNumber);
    const verdict = match?.status === 'completed' ? (match.finalScoreA === pred.predictionA && match.finalScoreB === pred.predictionB ? 'Correct' : 'Pending') : 'Pending';
    return `
      <div class="prediction-card">
        <div class="card-header">
          <h4>Match #${pred.matchNumber}</h4>
          <span class="status-chip">${verdict}</span>
        </div>
        <p class="meta-text">${match?.teamA || 'Team A'} ${pred.predictionA} - ${pred.predictionB} ${match?.teamB || 'Team B'}</p>
        <p class="meta-text">Last saved: ${formatSavedTime(pred.timestamp)}</p>
        <p class="meta-text">Points: ${pred.totalPoints}</p>
      </div>`;
  }).join('');
}

function renderLeaderboard() {
  const container = document.getElementById('leaderboardList');
  const leaderboard = buildLeaderboard();
  container.innerHTML = leaderboard.map((entry, index) => {
    const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
    return `
      <div class="leaderboard-row">
        <div class="d-flex align-items-center gap-2">
          <div class="rank-badge ${rankClass}">${index + 1}</div>
          <div>
            <strong>${entry.username}</strong>
            <div class="meta-text">Participation ${entry.participationPoints} • Result ${entry.correctResultPoints} • Exact ${entry.exactScorePoints} • Special ${entry.specialQuestionPoints}</div>
          </div>
        </div>
        <strong>${entry.totalPoints} pts</strong>
      </div>`;
  }).join('');
}

function renderAdmin() {
  const container = document.getElementById('adminDashboard');
  const user = getCurrentUser();
  if (!user || user.role !== 'admin') {
    container.innerHTML = '<div class="empty-state">Only the admin can access this panel.</div>';
    return;
  }
  const completed = state.matches.filter((m) => m.status === 'completed').length;
  const upcoming = state.matches.filter((m) => m.status === 'upcoming').length;
  const predictionsSubmitted = state.predictions.length;
  const questions = state.specialQuestions.length;

  container.innerHTML = `
    <div class="admin-card">
      <h4>Total Users</h4>
      <p class="count-display">${state.users.length}</p>
    </div>
    <div class="admin-card">
      <h4>Total Matches</h4>
      <p class="count-display">${state.matches.length}</p>
    </div>
    <div class="admin-card">
      <h4>Completed Matches</h4>
      <p class="count-display">${completed}</p>
    </div>
    <div class="admin-card">
      <h4>Upcoming Matches</h4>
      <p class="count-display">${upcoming}</p>
    </div>
    <div class="admin-card">
      <h4>Predictions Submitted</h4>
      <p class="count-display">${predictionsSubmitted}</p>
    </div>
    <div class="admin-card">
      <h4>Special Questions</h4>
      <p class="count-display">${questions}</p>
    </div>
    <div class="admin-card">
      <h4>Create Match</h4>
      <form id="createMatchForm" class="admin-form">
        <input name="matchNumber" type="number" placeholder="Match Number" required />
        <input name="tournament" placeholder="Tournament" required />
        <input name="teamA" placeholder="Team A" required />
        <input name="teamB" placeholder="Team B" required />
        <input name="kickoffDateTime" type="datetime-local" required />
        <button class="primary-btn" type="submit">Save Match</button>
      </form>
    </div>
    <div class="admin-card">
      <h4>Publish Result</h4>
      <form id="resultForm" class="admin-form">
        <select name="matchId">
          ${state.matches.map((match) => `<option value="${match.id}">#${match.matchNumber} ${match.teamA} vs ${match.teamB}</option>`).join('')}
        </select>
        <input name="finalScoreA" type="number" min="0" max="20" placeholder="Score A" required />
        <input name="finalScoreB" type="number" min="0" max="20" placeholder="Score B" required />
        <button class="primary-btn" type="submit">Publish Result</button>
      </form>
    </div>
    <div class="admin-card">
      <h4>Create Special Question</h4>
      <form id="questionForm" class="admin-form">
        <input name="question" placeholder="Question" required />
        <input name="correctAnswer" type="number" placeholder="Correct Answer" required />
        <input name="deadline" type="datetime-local" required />
        <input name="points" type="number" placeholder="Points" value="1" min="1" required />
        <button class="primary-btn" type="submit">Create Question</button>
      </form>
    </div>
    <div class="admin-card">
      <h4>Manage Matches</h4>
      ${state.matches.length ? state.matches.map((match) => `
        <div class="leaderboard-row">
          <div>
            <strong>#${match.matchNumber} ${match.teamA} vs ${match.teamB}</strong>
            <div class="meta-text">${match.tournament}</div>
          </div>
          <button class="ghost-btn delete-match-btn" data-match-id="${match.id}">Delete</button>
        </div>`).join('') : '<div class="empty-state">No matches to manage.</div>'}
    </div>`;
}

function buildLeaderboard() {
  const users = [...new Set(state.predictions.map((p) => p.username).concat(state.users.map((u) => u.username)))];
  const rows = users.map((username) => {
    const userPredictions = state.predictions.filter((p) => p.username === username);
    const participationPoints = userPredictions.reduce((sum, p) => sum + (p.participationPoints || 0), 0);
    const correctResultPoints = userPredictions.reduce((sum, p) => sum + (p.correctResultPoints || 0), 0);
    const exactScorePoints = userPredictions.reduce((sum, p) => sum + (p.exactScorePoints || 0), 0);
    const specialQuestionPoints = state.specialQuestionResponses.filter((r) => r.username === username).reduce((sum, entry) => sum + (entry.awardedPoints || 0), 0);
    const totalPoints = participationPoints + correctResultPoints + exactScorePoints + specialQuestionPoints;
    return { username, participationPoints, correctResultPoints, exactScorePoints, specialQuestionPoints, totalPoints };
  }).sort((a, b) => b.totalPoints - a.totalPoints);
  return rows;
}

function getPredictionForMatch(matchNumber) {
  const user = getCurrentUser();
  if (!user) return null;
  return state.predictions.find((item) => item.username === user.username && item.matchNumber === matchNumber) || null;
}

function isPredictionLocked(match) {
  return match.status === 'completed' || new Date(match.kickoffDateTime) <= new Date();
}

function formatDate(value) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatSavedTime(value) {
  if (!value) return 'Not saved yet';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getCountdownText(targetTime) {
  const remaining = new Date(targetTime) - new Date();
  if (remaining <= 0) return 'Kickoff has started';
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function updateCountdown() {
  const heroCountdown = document.getElementById('heroCountdown');
  const nextMatch = state.matches.find((match) => match.status === 'upcoming') || state.matches[0];
  if (heroCountdown) heroCountdown.textContent = nextMatch ? getCountdownText(nextMatch.kickoffDateTime) : '--:--:--';
  const matchCards = document.querySelectorAll('.countdown');
  matchCards.forEach((item) => {
    const parent = item.closest('.match-card');
    if (parent) {
      const match = state.matches.find((entry) => entry.matchNumber === Number(parent.querySelector('.eyebrow').textContent.replace('Match #', '')));
      if (match) item.textContent = getCountdownText(match.kickoffDateTime);
    }
  });
}

function showView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.page-section').forEach((section) => section.classList.toggle('active', section.id === `view-${viewName}`));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === viewName));
  if (viewName === 'home') renderHome();
  if (viewName === 'upcoming') renderMatches();
  if (viewName === 'predictions') renderMyPredictions();
  if (viewName === 'leaderboard') renderLeaderboard();
  if (viewName === 'admin') renderAdmin();
}

function openAuthModal() {
  document.getElementById('authModal').classList.add('open');
  document.getElementById('authModalBackdrop').classList.add('open');
  document.getElementById('authModal').setAttribute('aria-hidden', 'false');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('open');
  document.getElementById('authModalBackdrop').classList.remove('open');
  document.getElementById('authModal').setAttribute('aria-hidden', 'true');
}

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('modalTitle').textContent = mode === 'login' ? 'Welcome back' : 'Create account';
  document.getElementById('modalSwitchCopy').innerHTML = mode === 'login' ? 'New here? <a href="#" id="toggleAuthMode">Create account</a>' : 'Already have an account? <a href="#" id="toggleAuthMode">Sign in</a>';
  document.getElementById('toggleAuthMode').addEventListener('click', (event) => {
    event.preventDefault();
    setAuthMode(authMode === 'login' ? 'register' : 'login');
  });
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!username || !password) {
    showToast('Please provide both username and password.');
    return;
  }
  if (authMode === 'register') {
    await loadRemoteState();
    const exists = state.users.some((user) => user.username.toLowerCase() === username.toLowerCase());
    if (exists) {
      showToast('Username already exists.');
      return;
    }
    const newUser = { username, password, role: 'user' };
    state.users.push(newUser);
    saveState();
    await syncToBackend('saveUser', newUser);
    await loadRemoteState();
    const createdUser = state.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
    if (!createdUser) {
      showToast('Unable to sync new user to Google Sheets.');
      return;
    }
    state.sessionUser = { username: createdUser.username, role: createdUser.role };
    saveState();
    updateAuthButton();
    showToast(`Welcome, ${username}!`);
    closeAuthModal();
    renderAll();
    return;
  }
  await loadRemoteState();
  const user = state.users.find((entry) => entry.username.toLowerCase() === username.toLowerCase() && entry.password === password);
  if (!user) {
    showToast('Invalid username or password.');
    return;
  }
  state.sessionUser = { username: user.username, role: user.role };
  saveState();
  updateAuthButton();
  showToast(`Welcome back, ${username}.`);
  closeAuthModal();
  renderAll();
}

async function handlePredictionSubmit(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) {
    showToast('Please log in to save a prediction.');
    openAuthModal();
    return;
  }
  const form = event.currentTarget;
  const matchId = Number(form.dataset.matchId);
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return;
  if (isPredictionLocked(match)) {
    showToast('Predictions are closed for this match.');
    return;
  }
  const predictionA = Number(form.predictionA.value);
  const predictionB = Number(form.predictionB.value);
  const existing = state.predictions.find((item) => item.username === user.username && item.matchNumber === match.matchNumber);
  const settings = getPointSettings();
  const payload = {
    username: user.username,
    matchNumber: match.matchNumber,
    predictionA,
    predictionB,
    timestamp: new Date().toISOString(),
    participationPoints: Number(settings.participationPoints || 1),
    correctResultPoints: 0,
    exactScorePoints: 0,
    totalPoints: Number(settings.participationPoints || 1)
  };
  if (existing) {
    Object.assign(existing, payload);
  } else {
    state.predictions.push(payload);
  }
  saveState();
  await syncAndRefresh('savePrediction', payload);
  showToast('Prediction saved successfully.');
}

async function handleSpecialQuestionSubmit(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) {
    showToast('Please log in to submit an answer.');
    openAuthModal();
    return;
  }
  const form = event.currentTarget;
  const answerInput = form.querySelector('input[name="specialAnswer"]') || document.getElementById('specialAnswerInput');
  const answer = answerInput?.value;
  const question = state.specialQuestions.find((item) => item.status === 'active') || state.specialQuestions[0];
  if (!question || !answer) {
    showToast('Please enter a numeric answer.');
    return;
  }
  const payload = {
    username: user.username,
    questionID: question.id,
    userAnswer: answer,
    awardedPoints: Number(answer) === question.correctAnswer ? question.points : 0,
    timestamp: new Date().toISOString()
  };
  await syncAndRefresh('saveSpecialResponse', payload);
  showToast('Special question answer saved.');
}

async function handleCreateMatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    id: Date.now(),
    matchNumber: Number(form.matchNumber.value),
    tournament: form.tournament.value,
    teamA: form.teamA.value,
    teamB: form.teamB.value,
    kickoffDateTime: new Date(form.kickoffDateTime.value).toISOString(),
    finalScoreA: null,
    finalScoreB: null,
    status: 'upcoming'
  };
  state.matches.push(payload);
  saveState();
  await syncAndRefresh('saveMatch', payload);
  showToast('Match created.');
}

async function handleDeleteMatch(event) {
  const button = event.target.closest('.delete-match-btn');
  if (!button) return;
  const matchId = Number(button.dataset.matchId);
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return;
  state.matches = state.matches.filter((item) => item.id !== matchId);
  state.predictions = state.predictions.filter((prediction) => prediction.matchNumber !== match.matchNumber);
  saveState();
  await syncAndRefresh('deleteMatch', { id: matchId });
  showToast('Match deleted.');
}

async function handlePublishResult(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const match = state.matches.find((item) => item.id === Number(form.matchId.value));
  if (!match) return;
  const settings = getPointSettings();
  match.finalScoreA = Number(form.finalScoreA.value);
  match.finalScoreB = Number(form.finalScoreB.value);
  match.status = 'completed';
  state.predictions.forEach((prediction) => {
    if (prediction.matchNumber === match.matchNumber) {
      if (prediction.predictionA === match.finalScoreA && prediction.predictionB === match.finalScoreB) {
        prediction.exactScorePoints = Number(settings.exactScorePoints || 3);
        prediction.correctResultPoints = 0;
      } else if ((match.finalScoreA > match.finalScoreB && prediction.predictionA > prediction.predictionB) || (match.finalScoreA < match.finalScoreB && prediction.predictionA < prediction.predictionB) || (match.finalScoreA === match.finalScoreB && prediction.predictionA === prediction.predictionB)) {
        prediction.correctResultPoints = Number(settings.correctResultPoints || 2);
        prediction.exactScorePoints = 0;
      } else {
        prediction.correctResultPoints = 0;
        prediction.exactScorePoints = 0;
      }
      prediction.totalPoints = prediction.participationPoints + prediction.correctResultPoints + prediction.exactScorePoints;
    }
  });
  saveState();
  await syncAndRefresh('saveMatch', match);
  showToast('Result published and leaderboard updated.');
}

async function handleCreateQuestion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    id: Date.now(),
    question: form.question.value,
    correctAnswer: Number(form.correctAnswer.value),
    deadline: new Date(form.deadline.value).toISOString(),
    status: 'active',
    points: Number(form.points.value || 1)
  };
  state.specialQuestions.push(payload);
  saveState();
  await syncAndRefresh('saveQuestion', payload);
  showToast('Special question created.');
}

function renderAll() {
  updateAuthButton();
  renderHome();
  renderMatches();
  renderMyPredictions();
  renderLeaderboard();
  renderAdmin();
  if (currentView === 'home') showView('home');
  else if (currentView === 'upcoming') showView('upcoming');
  else if (currentView === 'predictions') showView('predictions');
  else if (currentView === 'leaderboard') showView('leaderboard');
  else if (currentView === 'admin') showView('admin');
}

function attachListeners() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      if (view === 'home') showView('home');
      if (view === 'upcoming') showView('upcoming');
      if (view === 'predictions') showView('predictions');
      if (view === 'leaderboard') showView('leaderboard');
      if (view === 'admin') showView('admin');
    });
  });

  document.getElementById('authButton').addEventListener('click', () => {
    if (getCurrentUser()) {
      logoutUser();
    } else {
      openAuthModal();
    }
  });
  document.getElementById('adminButton').addEventListener('click', () => showView('admin'));
  document.getElementById('closeModalBtn').addEventListener('click', closeAuthModal);
  document.getElementById('authModalBackdrop').addEventListener('click', closeAuthModal);
  document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
  document.getElementById('specialQuestionForm').addEventListener('submit', handleSpecialQuestionSubmit);
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    showToast('Theme toggle ready for your preference.');
  });
  document.addEventListener('submit', (event) => {
    if (event.target.classList.contains('prediction-form')) handlePredictionSubmit(event);
    if (event.target.classList.contains('inline-question-form')) handleSpecialQuestionSubmit(event);
    if (event.target.id === 'specialQuestionForm') handleSpecialQuestionSubmit(event);
    if (event.target.id === 'createMatchForm') handleCreateMatch(event);
    if (event.target.id === 'resultForm') handlePublishResult(event);
    if (event.target.id === 'questionForm') handleCreateQuestion(event);
  });
  document.addEventListener('click', (event) => {
    if (event.target.id === 'toggleAuthMode') {
      event.preventDefault();
      setAuthMode(authMode === 'login' ? 'register' : 'login');
    }
    if (event.target.closest('.delete-match-btn')) {
      handleDeleteMatch(event);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAuthModal();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setAuthMode('login');
  attachListeners();
  renderAll();
  setInterval(updateCountdown, 1000);
  setTimeout(() => document.getElementById('splashScreen').classList.add('hidden'), 700);
  if (window.location.protocol === 'https:' || window.location.protocol === 'http:') {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        return Promise.all(registrations.map((registration) => registration.unregister()));
      }).then(() => navigator.serviceWorker.register('./sw.js')).catch(console.warn);
    }
  }
  loadRemoteState(true);
});
