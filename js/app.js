/**
 * York Breathing Exercise Timer - Main Application
 * 
 * This is the main JavaScript file for the EMST 150 Trainer application.
 * It manages the timer state machine, UI updates, audio feedback, and animations.
 * 
 * Architecture Overview (for beginners):
 * - The UI has two screens (`#setup-screen` and `#workout-screen`) that are shown/hidden.
 * - The timer is implemented as a simple state machine using `TIMER_STATE`.
 * - Each active rep is internally divided into `SUB_PHASE`s (Inhale, Exhale, Rest) which control
 *   the on-screen instructions and sounds.
 * - Timing constants near the top (e.g., LONG_BREAK_DURATION_MS) control session length.
 * - To change core behavior (number of sets, reps, or break length), edit the constants below.
 */

// ============================================================
// FIREBASE CONFIGURATION (Optional)
// ============================================================
// Firebase variables (may be provided by host environment). Not required to run the timer locally.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// ============================================================
// TIMER STATE CONSTANTS
// ============================================================

/**
 * Timer State Machine States
 * 
 * The app uses a state machine pattern to manage the timer flow.
 * - IDLE: Not running, waiting to start
 * - PAUSED: Session temporarily paused by user
 * - ACTIVE_REP: Currently in a rep (15s or 30s block depending on settings)
 * - LONG_BREAK: Long rest period between sets (approximately 56s)
 */
const TIMER_STATE = {
    IDLE: 'IDLE',
    PAUSED: 'PAUSED',
    ACTIVE_REP: 'ACTIVE_REP',
    LONG_BREAK: 'LONG_BREAK',
};

/**
 * Sub-Phase Labels
 * 
 * During an ACTIVE_REP, the timer cycles through three sub-phases:
 * - INHALE: First 1 second - deep breath in
 * - EXHALE: Next 2 seconds - forceful exhale against resistance
 * - REST: Remaining time - recovery before next rep
 * 
 * These labels are shown in the status area and used to pick colors/sounds.
 */
const SUB_PHASE = {
    INHALE: 'Inhale Deeply',
    EXHALE: 'Exhale Forcefully',
    REST: 'Rest & Recover',
};

// ============================================================
// SESSION CONFIGURATION CONSTANTS
// ============================================================
// Edit these values to change the workout structure

/** Total number of reps in a complete session (5 sets × 5 reps = 25) */
const TOTAL_REPS = 25;

/** Number of long breaks in a session (after sets 1, 2, 3, and 4) */
const NUM_LONG_BREAKS = 4;

/** Duration of long breaks between sets in milliseconds (56 seconds) */
const LONG_BREAK_DURATION_MS = 56000;

/** Duration of partial rep used at the end of session in milliseconds (3 seconds) */
const PARTIAL_REP_DURATION_MS = 3000;

// ============================================================
// USER-FACING TEXT CONSTANTS
// ============================================================
// Edit these to customize the instructional text shown to users

/** Instructions shown on the setup screen before starting */
const INITIAL_INSTRUCTIONS = "Please make sure your sound is ON and the volume is turned up. Then press \"Start Session\" to begin. Focus on inhaling deeply and exhaling forcefully and quickly against the device's resistance.";

/** Text shown during the exhale phase */
const EXHALE_INSTRUCTIONS = 'Exhale Quickly';

/** Text shown when the session is paused */
const PAUSE_INSTRUCTIONS = "Session Paused.<br>Click 'Resume' to Continue.";

// ============================================================
// PHASE DURATION CONFIGURATION
// ============================================================

/**
 * Phase Duration Map
 * 
 * Controls how many milliseconds each top-level state lasts.
 * The ACTIVE_REP duration will be updated when user selects 15s or 30s mode.
 */
const PHASE_DURATIONS_MS = {
    [TIMER_STATE.ACTIVE_REP]: 15000,   // Default: 15s (1s Inhale + 2s Exhale + 12s Rest)
    [TIMER_STATE.LONG_BREAK]: 56000    // Long break: 56 seconds
};

// ============================================================
// RUNTIME CONFIGURATION VARIABLES
// ============================================================
// These can change while the user interacts with the app

/** Currently selected rep length in milliseconds */
let currentRepDurationMs = 15000;

/** Label shown during the rest subphase */
let currentRestLabel = 'Rest & Recover';

/** Computed total session duration in milliseconds */
let totalSessionDurationMs = 0;

/** Selected duration mode: '15' or '30' seconds */
let selectedDuration = '15';

// ============================================================
// UI COLOR CONFIGURATION
// ============================================================

/**
 * Phase Color Classes
 * 
 * Tailwind CSS color classes applied to the status text for each phase.
 * Edit these to change the color scheme of the status messages.
 */
const PHASE_COLOR_CLASS = {
    [SUB_PHASE.INHALE]: 'text-cyan-400',
    [SUB_PHASE.EXHALE]: 'text-red-500',
    [SUB_PHASE.REST]: 'text-white',
    [TIMER_STATE.LONG_BREAK]: 'text-yellow-400',
    [TIMER_STATE.PAUSED]: 'text-yellow-500',
    [TIMER_STATE.IDLE]: 'text-white'
};

/**
 * Confetti Colors
 * 
 * Array of hex color codes used for the celebration effect particles.
 * Edit these to customize the party colors shown on session completion.
 */
const CONFETTI_COLORS = ['#f9fafb', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']; // White, Emerald, Amber, Red, Blue

// ============================================================
// MUTABLE RUNTIME STATE
// ============================================================
// These variables are updated by the state machine during operation

/** Current state of the timer (from TIMER_STATE enum) */
let currentState = TIMER_STATE.IDLE;

/** requestAnimationFrame ID for cancellation */
let animationFrameId = null;

/** Total reps completed so far (max TOTAL_REPS) */
let repCount = 0;

/** Timestamp when the current phase started */
let phaseStartTime = 0;

/** Timestamp when the session started */
let sessionStartTime = 0;

/** Remaining milliseconds in current phase when paused */
let timeRemainingWhenPaused = 0;

/** Remaining total session time while paused */
let sessionTimeRemainingWhenPaused = 0;

/** Rep counts for each of the 5 sets displayed in UI */
let setProgress = [0, 0, 0, 0, 0];

/** State to restore after unpausing (ACTIVE_REP or LONG_BREAK) */
let activeStateBeforePause = TIMER_STATE.ACTIVE_REP;

/** Helper flag for the reset confirmation modal */
let wasRunningBeforeModal = false;

// ============================================================
// WAKE LOCK STATE
// ============================================================
// Wake Lock keeps the screen awake while session runs

/** Wake Lock sentinel object (null when not active) */
let wakeLockSentinel = null;

// ============================================================
// DOM ELEMENT REFERENCES
// ============================================================

const startScreen = document.getElementById('setup-screen');
const workoutScreen = document.getElementById('workout-screen');
const startButton = document.getElementById('start-button');
const activeControls = document.getElementById('active-controls');
const pauseResumeButton = document.getElementById('pause-resume-button');
const resetButton = document.getElementById('reset-button');
const statusText = document.getElementById('status-text');
const timerValue = document.getElementById('timer-value');
const pulseRing = document.getElementById('pulse-ring');
const timerContainer = document.getElementById('timer-display-container').querySelector('.relative.flex.flex-col');
const setBoxes = document.querySelectorAll('.set-box');
const totalTimeValue = document.getElementById('total-time-value');
const confettiContainer = document.getElementById('confetti-container');
const btnDuration15 = document.getElementById('btn-duration-15');
const btnDuration30 = document.getElementById('btn-duration-30');

// Modal Elements
const resetModal = document.getElementById('reset-modal');
const confirmResetButton = document.getElementById('confirm-reset');
const cancelResetButton = document.getElementById('cancel-reset');

// ============================================================
// AUDIO CONTEXT
// ============================================================

/** Web Audio API context for playing tones */
let audioContext;

// ============================================================
// WAKE LOCK FUNCTIONS
// ============================================================

/**
 * Request a Wake Lock to keep the screen awake during the session.
 * 
 * Uses the Screen Wake Lock API if available. If the wake lock is released
 * (e.g., when the app moves to background), it will attempt to re-request
 * when the user returns if the timer is still active.
 */
const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
        try {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            wakeLockSentinel.addEventListener('release', () => {
                // The wake lock was released (e.g., app moved to background)
                // If the timer is still active, try to re-request it when the user returns
                if (currentState !== TIMER_STATE.IDLE && currentState !== TIMER_STATE.PAUSED) {
                    requestWakeLock();
                }
            });
        } catch (err) {
            // Suppress NotAllowedError as it's often due to environment/iframe restrictions.
            if (err.name !== 'NotAllowedError') {
                console.error(`Wake Lock request failed: ${err.name}, ${err.message}`);
            }
        }
    }
};

/**
 * Release the current Wake Lock if one is held.
 * Called when pausing or ending the session.
 */
const releaseWakeLock = () => {
    if (wakeLockSentinel !== null) {
        wakeLockSentinel.release();
        wakeLockSentinel = null;
    }
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Formats milliseconds into M:SS string format.
 * 
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted time string (e.g., "02:30")
 */
const formatTime = (ms) => {
    if (ms <= 0) return '0:00';
    
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    const pad = (num) => num.toString().padStart(2, '0');
    
    return `${pad(minutes)}:${pad(seconds)}`;
};

/**
 * Calculates the total session duration from the rep duration.
 * 
 * For beginners: the math here adds together the time for the main full reps,
 * the scheduled long breaks, and a small fixed amount for partial end reps.
 * Change the constants (FULL_REPS, PARTIAL_REPS_MS) if you want to alter session structure.
 * 
 * @param {number} repDurationMs - Duration of each rep in milliseconds
 */
const calculateTotalDuration = (repDurationMs) => {
    // Full reps in the session (default 20 full reps + 5 partials spread across sets)
    const FULL_REPS = 20;
    // The app uses 5 short partial exhale breaths totaling 15 seconds
    const PARTIAL_REPS_MS = 5 * 3000; // 5 × 3s
    // Long breaks total duration (4 breaks, each LONG_BREAK_DURATION_MS long)
    const FIXED_BREAK_MS = 4 * LONG_BREAK_DURATION_MS;

    totalSessionDurationMs = (FULL_REPS * repDurationMs) + FIXED_BREAK_MS + PARTIAL_REPS_MS;
};

// ============================================================
// CELEBRATION / CONFETTI FUNCTIONS
// ============================================================

/**
 * Generates and animates a burst of confetti for session completion.
 * 
 * Beginner notes:
 * - The particle count (150), sizes, colors, and animation durations can be tweaked here.
 * - The `CONFETTI_COLORS` array above controls which colors are used.
 * - Particles are created as DOM elements and removed after animation completes.
 */
const showCelebration = () => {
    // Clear existing confetti
    confettiContainer.innerHTML = '';
    
    // Generate 150 particles (change this number to make the effect denser or lighter)
    for (let i = 0; i < 150; i++) {
        const confetti = document.createElement('div');
        confetti.classList.add('confetti');
        
        // Random position, color, size, and delay
        confetti.style.left = `${Math.random() * 100}vw`;
        confetti.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        // Make confetti particles bigger: base size 10px, random additional up to 10px
        confetti.style.width = `${Math.random() * 10 + 10}px`;
        confetti.style.height = confetti.style.width;
        // Make confetti fall slower for more visibility and longer duration
        confetti.style.animationDuration = `${Math.random() * 4 + 3}s`; // 3s to 7s duration
        confetti.style.animationDelay = `${Math.random() * 0.8}s`; // Slightly longer delay spread
        confetti.style.opacity = 1;
        
        confettiContainer.appendChild(confetti);
    }
    
    // Hide and clear confetti after the maximum animation duration (e.g., 9 seconds max + a buffer)
    setTimeout(() => {
        confettiContainer.innerHTML = '';
    }, 10000); // 10 seconds total to ensure all animations complete
};

// ============================================================
// UI UPDATE FUNCTIONS
// ============================================================

/**
 * Sets the content and adjusts the font size of the main status display.
 * 
 * @param {string} text - HTML text to display
 * @param {string} phase - Current phase (used to determine color)
 */
const setStatusText = (text, phase) => {
    statusText.innerHTML = text;
    
    // Determine color class: use phase color if available, otherwise default to white
    const colorClass = PHASE_COLOR_CLASS[phase] || PHASE_COLOR_CLASS[TIMER_STATE.IDLE];
    statusText.className = `font-extrabold mb-2 h-10 flex items-center justify-center transition-colors duration-300 ${colorClass}`;

    // Adjust font size based on content length or line breaks
    if (text.length > 25 || text.includes('<br>')) {
        // For long messages/instructions/breaks
        statusText.classList.add('text-lg', 'font-semibold');
        statusText.classList.remove('text-2xl');
    } else {
        // For short phase names (e.g., Inhale Deeply, Paused, Ready)
        statusText.classList.add('text-2xl');
        statusText.classList.remove('text-lg', 'font-semibold');
    }
};

/**
 * Updates the visual state of the set progress boxes.
 * 
 * Each box shows the rep count for that set and changes color based on progress:
 * - Gray (bg-gray-500): Not started (0 reps)
 * - Dark gray (bg-gray-900): In progress (1-4 reps)
 * - Green (bg-primary): Completed (5 reps) - shows checkmark
 */
const updateSetBoxes = () => {
    setProgress.forEach((reps, index) => {
        const box = setBoxes[index];
        const counterElement = box.querySelector('.set-rep-counter');
        const checkmarkElement = box.querySelector('.checkmark-container');
        counterElement.textContent = reps;
        box.classList.remove('bg-gray-500', 'bg-gray-900', 'bg-primary');
        if (reps === 0) {
            box.classList.add('bg-gray-500');
            checkmarkElement.classList.add('hidden');
        } else if (reps >= 1 && reps <= 4) {
            box.classList.add('bg-gray-900');
            checkmarkElement.classList.add('hidden');
        } else if (reps === 5) {
            box.classList.add('bg-primary');
            checkmarkElement.classList.remove('hidden');
        }
    });
};

/**
 * Updates the main timer display UI elements.
 * 
 * @param {string} phase - Current phase or sub-phase
 * @param {number} remainingTimeS - Remaining time in seconds
 */
const updateUI = (phase, remainingTimeS) => {
    timerValue.textContent = Math.ceil(remainingTimeS).toString();
    const isCriticalPhase = (phase === SUB_PHASE.EXHALE || phase === SUB_PHASE.INHALE);
    if (isCriticalPhase) {
        pulseRing.classList.remove('hidden');
        pulseRing.classList.add('timer-ring-active');
        timerContainer.classList.add('border-primary');
        timerValue.classList.add('text-primary');
    } else {
        pulseRing.classList.add('hidden');
        pulseRing.classList.remove('timer-ring-active');
        timerContainer.classList.remove('border-primary');
        timerValue.classList.remove('text-primary');
    }
};

// ============================================================
// MODAL FUNCTIONS
// ============================================================

/**
 * Opens the reset confirmation modal.
 */
const openResetModal = () => {
    resetModal.classList.remove('hidden');
    resetModal.classList.add('flex');
};

/**
 * Closes the reset confirmation modal.
 */
const closeResetModal = () => {
    resetModal.classList.add('hidden');
    resetModal.classList.remove('flex');
};

// ============================================================
// DURATION SELECTOR FUNCTIONS
// ============================================================

/**
 * Updates the visual state of the duration selector buttons.
 * 
 * @param {string} value - Selected duration ('15' or '30')
 */
const updateDurationButtons = (value) => {
    if (value === '15') {
        btnDuration15.classList.add('bg-primary', 'text-white', 'border-primary');
        btnDuration15.classList.remove('bg-gray-600', 'text-gray-300', 'border-transparent', 'hover:border-gray-500');
        
        btnDuration30.classList.add('bg-gray-600', 'text-gray-300', 'border-transparent', 'hover:border-gray-500');
        btnDuration30.classList.remove('bg-primary', 'text-white', 'border-primary');
    } else {
        btnDuration30.classList.add('bg-primary', 'text-white', 'border-primary');
        btnDuration30.classList.remove('bg-gray-600', 'text-gray-300', 'border-transparent', 'hover:border-gray-500');
        
        btnDuration15.classList.add('bg-gray-600', 'text-gray-300', 'border-transparent', 'hover:border-gray-500');
        btnDuration15.classList.remove('bg-primary', 'text-white', 'border-primary');
    }
};

/**
 * Handles rest duration selection change.
 * 
 * Updates the internal configuration and UI when user selects 15s or 30s mode.
 * If a session is running, it will be reset.
 * 
 * @param {string} value - Selected duration ('15' or '30')
 */
window.handleRestDurationChange = (value) => {
    selectedDuration = value;
    updateDurationButtons(value); // Update UI visuals

    let newDurationMs;
    let newLabel;

    if (value === '30') {
        newDurationMs = 30000; // 1s Inhale + 2s Exhale + 27s Rest = 30s
        newLabel = 'Rest & Recover'; // Simplified label
    } else {
        newDurationMs = 15000; // 1s Inhale + 2s Exhale + 12s Rest = 15s
        newLabel = 'Rest & Recover'; // Simplified label
    }

    // Check if session is running and force reset
    if (currentState !== TIMER_STATE.IDLE) {
        resetSession(false);
        setStatusText(`Duration Changed. Session Was Reset. Press 'Start Session' to Begin.`, TIMER_STATE.IDLE);
    }

    // Update internal variables and constants globally
    currentRepDurationMs = newDurationMs;
    currentRestLabel = newLabel;
    PHASE_DURATIONS_MS[TIMER_STATE.ACTIVE_REP] = currentRepDurationMs;
    
    // Recalculate total session duration
    calculateTotalDuration(currentRepDurationMs);
    // Update total time display with new total duration
    totalTimeValue.textContent = formatTime(totalSessionDurationMs);
};

// ============================================================
// AUDIO FUNCTIONS
// ============================================================

/**
 * Initializes the Web Audio API context.
 * Called when starting a session to enable sound feedback.
 */
const initAudio = () => {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error('Web Audio API not supported:', e);
        }
    }
};

/**
 * Plays a simple tone using the Web Audio API.
 * 
 * @param {number} frequency - Tone frequency in Hz
 * @param {number} duration - Tone duration in seconds
 */
const playTone = (frequency, duration) => {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    // Gain set to 5 for louder sound
    gainNode.gain.setValueAtTime(5, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
};

/** Tracks the last played sub-phase to avoid duplicate sounds */
let lastPlayedSubPhase = null;

/**
 * Plays a transition chime when entering a new sub-phase.
 * 
 * - Inhale and Rest: 440Hz tone (A4 note)
 * - Exhale: 880Hz tone (A5 note, one octave higher)
 * 
 * @param {string} subPhase - The sub-phase being entered
 */
const playTransitionChime = (subPhase) => {
    if (lastPlayedSubPhase === subPhase) return;
    if (subPhase === SUB_PHASE.INHALE || subPhase === SUB_PHASE.REST) {
        playTone(440, 0.1);
    }
    if (subPhase === SUB_PHASE.EXHALE) {
        playTone(880, 0.2);
    }
    lastPlayedSubPhase = subPhase;
};

// ============================================================
// SESSION CONTROL FUNCTIONS
// ============================================================

/**
 * Completes the session and shows the success screen.
 * 
 * This function:
 * - Stops the animation loop
 * - Releases the wake lock
 * - Shows "Success" message
 * - Hides the timer display
 * - Shows the "New Session" button
 * - Triggers the confetti celebration
 */
const finishSession = () => {
    // Finalize and show the success screen (no auto-reset) — waits for user to click "New Session"
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    releaseWakeLock();

    // Replace main instruction with a large SUCCESS label
    setStatusText('Success', TIMER_STATE.IDLE);
    // Enforce a large, prominent style for the success message
    statusText.classList.add('text-5xl', 'font-extrabold', 'h-14');

    // Hide the round timer display for a cleaner success screen
    if (timerContainer) {
        timerContainer.classList.add('hidden');
        timerContainer.setAttribute('aria-hidden', 'true');
    }

    // Center controls (including New Session) when the timer is hidden
    const controlsWrapper = document.getElementById('controls-wrapper');
    if (controlsWrapper) {
        controlsWrapper.classList.add('mx-auto', 'items-center');
    }

    // Ensure all completed sets show their checkmark
    updateSetBoxes();

    // Show celebration animation
    showCelebration();

    // Hide regular active controls (pause/reset) and show the "New Session" button
    activeControls.classList.add('hidden');
    const newSessionButton = document.getElementById('new-session-button');
    if (newSessionButton) newSessionButton.classList.remove('hidden');

    // Clear the Time Remaining display on success
    totalTimeValue.textContent = "0:00";

    // Do NOT auto-reset; the UI should remain in the success state until the user clicks New Session
};

/**
 * Resets the session to initial state.
 * 
 * @param {boolean} isCompleted - If true, shows "Session Complete!" message with celebration
 */
const resetSession = (isCompleted = false) => {
    // Stop any running animation and clear wake locks
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    releaseWakeLock();

    // Reset runtime state
    currentState = TIMER_STATE.IDLE;
    repCount = 0;
    timeRemainingWhenPaused = 0;
    sessionTimeRemainingWhenPaused = 0;
    setProgress = [0, 0, 0, 0, 0];
    lastPlayedSubPhase = null;
    sessionStartTime = 0;
    
    // Switch to the setup/start screen
    workoutScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    startButton.classList.remove('hidden');
    activeControls.classList.add('hidden');

    // Hide the New Session button if it was visible
    const newSessionButton = document.getElementById('new-session-button');
    if (newSessionButton) newSessionButton.classList.add('hidden');

    // Restore counters visibility (undo finishSession's hiding)
    document.querySelectorAll('.set-rep-counter').forEach(el => {
        el.classList.remove('hidden');
        el.removeAttribute('aria-hidden');
    });

    // Restore the round timer display (unhide the main timer circle)
    if (timerContainer) {
        timerContainer.classList.remove('hidden');
        timerContainer.removeAttribute('aria-hidden');
    }

    // Undo any centering applied for the success state so controls flow normally
    const controlsWrapper = document.getElementById('controls-wrapper');
    if (controlsWrapper) {
        controlsWrapper.classList.remove('mx-auto', 'items-center');
    }

    if (isCompleted) {
        setStatusText('Session<br>Complete!', TIMER_STATE.IDLE);
        showCelebration();
    } else {
        setStatusText('Ready', TIMER_STATE.IDLE);
    }
    
    // Reset UI visuals
    timerValue.textContent = '0';
    pulseRing.classList.add('hidden');
    pulseRing.classList.remove('timer-ring-active');
    timerContainer.classList.remove('border-primary');
    timerValue.classList.remove('text-primary');
    totalTimeValue.textContent = formatTime(totalSessionDurationMs);
    updateSetBoxes();
};

// ============================================================
// STATE MACHINE FUNCTIONS
// ============================================================

/**
 * Advances the top-level state machine to the next phase.
 * 
 * Note: repCount is incremented elsewhere (when a rep's rest subphase begins). This function
 * determines whether we should go to a long break (after a full set), immediately start another
 * active rep, or end the session when all reps are complete.
 */
const nextState = () => {
    let nextPhase;
    switch (currentState) {
        case TIMER_STATE.ACTIVE_REP:
            // Update the current set display using the latest repCount
            const currentSetIndex = Math.floor((repCount - 1) / 5);
            const currentRepInSet = (repCount % 5) || 5;
            if (currentSetIndex < 5) {
                setProgress[currentSetIndex] = currentRepInSet;
                updateSetBoxes();
            }

            // If we've completed all reps, finish the session
            if (repCount >= TOTAL_REPS) {
                finishSession();
                return;
            }
            // If we just finished a set (every 5 reps), take a long break
            else if (repCount % 5 === 0) {
                nextPhase = TIMER_STATE.LONG_BREAK;
            }
            // Otherwise, start the next active rep immediately
            else {
                nextPhase = TIMER_STATE.ACTIVE_REP;
            }
            break;
        case TIMER_STATE.LONG_BREAK:
            // After a long break, resume active reps
            nextPhase = TIMER_STATE.ACTIVE_REP;
            break;
        case TIMER_STATE.IDLE:
            // From idle we go to an active rep when starting the session
            nextPhase = TIMER_STATE.ACTIVE_REP;
            break;
        default:
            resetSession();
            return;
    }
    currentState = nextPhase;
    phaseStartTime = Date.now();
    lastPlayedSubPhase = null;
    
    if (currentState === TIMER_STATE.LONG_BREAK) {
        const completedSet = repCount / 5;
        const breakMessage = `Long Rest (Set ${completedSet} Complete)`;
        setStatusText(breakMessage, currentState);
    }
    updateUI(currentState, PHASE_DURATIONS_MS[currentState] / 1000);
};

/**
 * Updates the state shown to the user during an active rep.
 * 
 * The active rep is subdivided into:
 * - INHALE: First 1 second
 * - EXHALE: Next 2 seconds
 * - REST: Remaining time
 * 
 * To change inhale/exhale durations, modify the numeric thresholds below (1000ms, 3000ms).
 * 
 * @param {number} elapsedMs - Milliseconds elapsed since rep started
 */
const updateActiveRepStatus = (elapsedMs) => {
    let subPhase;
    if (elapsedMs < 1000) { // First 1 second: inhale
        subPhase = SUB_PHASE.INHALE;
    } else if (elapsedMs < 3000) { // Next 2 seconds: exhale
        subPhase = SUB_PHASE.EXHALE;
    } else {
        // Rest portion of the rep — we increment repCount once per rep when rest begins
        subPhase = SUB_PHASE.REST;
        if (lastPlayedSubPhase !== SUB_PHASE.REST) {
            repCount++;
            const currentSetIndex = Math.floor((repCount - 1) / 5);
            const currentRepInSet = (repCount % 5) || 5;
            if (currentSetIndex < 5) {
                setProgress[currentSetIndex] = currentRepInSet;
                updateSetBoxes();
            }
            
            // If this rep completed a set, prepare for a long break
            if (repCount % 5 === 0) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
                if (repCount >= TOTAL_REPS) {
                    finishSession();
                    return;
                }
                if (repCount < TOTAL_REPS) {
                    currentState = TIMER_STATE.LONG_BREAK;
                    phaseStartTime = Date.now();
                    lastPlayedSubPhase = null;
                    const completedSet = repCount / 5;
                    const breakMessage = `Long Rest (Set ${completedSet} Complete)`;
                    setStatusText(breakMessage, currentState);
                    updateUI(currentState, PHASE_DURATIONS_MS[currentState] / 1000);
                    requestAnimationFrame(tick);
                    return;
                }
            }
        }
    }
    playTransitionChime(subPhase);
    let displayText;
    if (subPhase === SUB_PHASE.EXHALE) {
        displayText = EXHALE_INSTRUCTIONS;
    } else if (subPhase === SUB_PHASE.REST) {
        displayText = currentRestLabel;
    } else {
        displayText = SUB_PHASE.INHALE;
    }
    setStatusText(displayText, subPhase);
};

/**
 * Main animation loop tick function.
 * 
 * Called repeatedly via requestAnimationFrame to update the timer display
 * and check for phase transitions.
 */
const tick = () => {
    if (currentState === TIMER_STATE.IDLE || currentState === TIMER_STATE.PAUSED) return;
    const now = Date.now();
    const elapsed = now - phaseStartTime;
    const duration = PHASE_DURATIONS_MS[currentState];
    let remaining = duration - elapsed;
    
    if (remaining <= 0) {
        nextState();
    } else {
        updateUI(currentState, remaining / 1000);
        if (currentState === TIMER_STATE.ACTIVE_REP) {
            updateActiveRepStatus(elapsed);
        }
    }
    
    // --- Total Time Calculation (currently hidden in UI) ---
    const totalElapsed = now - sessionStartTime;
    let totalRemaining = totalSessionDurationMs - totalElapsed;
    if (totalRemaining < 0) totalRemaining = 0;
    // totalTimeValue.textContent = formatTime(totalRemaining); // Hidden for now

    animationFrameId = requestAnimationFrame(tick);
};

// ============================================================
// SESSION START/PAUSE/RESUME FUNCTIONS
// ============================================================

/**
 * Starts a new session.
 * 
 * Sets up audio, requests wake lock (keeps the screen awake), switches screens,
 * and begins the animation loop which drives the timer.
 */
const startSession = () => {
    if (currentState !== TIMER_STATE.IDLE) return;
    initAudio();          // prepare sound (if available)
    requestWakeLock();    // try to keep the screen awake while session is active
    startScreen.classList.add('hidden');
    workoutScreen.classList.remove('hidden');
    activeControls.classList.remove('hidden');
    pauseResumeButton.textContent = 'Pause';
    pauseResumeButton.classList.remove('bg-yellow-500', 'hover:bg-yellow-600');
    pauseResumeButton.classList.add('bg-red-600', 'hover:bg-red-700');
    sessionStartTime = Date.now();
    nextState();
    animationFrameId = requestAnimationFrame(tick);
};

/**
 * Pauses the running timer.
 * 
 * Stops the animation loop, releases the wake lock, and saves
 * the current remaining times so we can resume exactly where we left off.
 */
const pauseTimer = () => {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    releaseWakeLock();
    const elapsedSincePhaseStart = Date.now() - phaseStartTime;
    const duration = PHASE_DURATIONS_MS[currentState];
    timeRemainingWhenPaused = duration - elapsedSincePhaseStart;
    
    // Capture current Total Time Remaining state for Resume
    sessionTimeRemainingWhenPaused = totalSessionDurationMs - (Date.now() - sessionStartTime);

    activeStateBeforePause = currentState;
    currentState = TIMER_STATE.PAUSED;
    lastPlayedSubPhase = null;
    pauseResumeButton.textContent = 'Resume';
    pauseResumeButton.classList.remove('bg-red-600', 'hover:bg-red-700');
    pauseResumeButton.classList.add('bg-yellow-500', 'hover:bg-yellow-600');
    setStatusText(PAUSE_INSTRUCTIONS, TIMER_STATE.PAUSED);
    updateUI(currentState, timeRemainingWhenPaused / 1000);
    
    // Ensure display is static and correct
    if (sessionTimeRemainingWhenPaused < 0) sessionTimeRemainingWhenPaused = 0;
    totalTimeValue.textContent = formatTime(sessionTimeRemainingWhenPaused);
};

/**
 * Resumes a paused session.
 * 
 * Restores the saved times, re-requests wake lock, and continues ticking.
 */
const resumeTimer = () => {
    currentState = activeStateBeforePause;
    requestWakeLock();
    const duration = PHASE_DURATIONS_MS[currentState];
    phaseStartTime = Date.now() - (duration - timeRemainingWhenPaused);
    timeRemainingWhenPaused = 0;
    
    // Restore Session Start Time from saved Remaining Time
    // New Start Time = Now - (TotalDuration - Remaining)
    sessionStartTime = Date.now() - (totalSessionDurationMs - sessionTimeRemainingWhenPaused);

    pauseResumeButton.textContent = 'Pause';
    pauseResumeButton.classList.add('bg-red-600', 'hover:bg-red-700');
    pauseResumeButton.classList.remove('bg-yellow-500', 'hover:bg-yellow-600');
    
    if (currentState === TIMER_STATE.LONG_BREAK) {
        const completedSet = repCount / 5;
        const breakMessage = `Long Rest (Set ${completedSet} Complete)`;
        setStatusText(breakMessage, currentState);
    } else if (currentState === TIMER_STATE.ACTIVE_REP) {
        const elapsed = Date.now() - phaseStartTime;
        updateActiveRepStatus(elapsed);
    }
    animationFrameId = requestAnimationFrame(tick);
    updateUI(currentState, (duration - (Date.now() - phaseStartTime)) / 1000);
};

// ============================================================
// EVENT LISTENERS
// ============================================================

// Start button - begins a new session
startButton.addEventListener('click', () => {
    if (currentState === TIMER_STATE.IDLE) startSession();
});

// Pause/Resume button - toggles between paused and running states
pauseResumeButton.addEventListener('click', () => {
    if (currentState === TIMER_STATE.PAUSED) resumeTimer();
    else if (currentState !== TIMER_STATE.IDLE) pauseTimer();
});

// Reset button - opens confirmation modal
resetButton.addEventListener('click', () => {
    if (currentState !== TIMER_STATE.IDLE) {
        wasRunningBeforeModal = (currentState !== TIMER_STATE.PAUSED);
        if (wasRunningBeforeModal) pauseTimer();
        openResetModal();
    }
});

// Modal confirm button - resets the session
confirmResetButton.addEventListener('click', () => {
    resetSession(false);
    closeResetModal();
    wasRunningBeforeModal = false;
});

// Modal cancel button - closes modal and optionally resumes
cancelResetButton.addEventListener('click', () => {
    closeResetModal();
    if (wasRunningBeforeModal) resumeTimer();
    wasRunningBeforeModal = false;
});

// New Session button - resets after successful completion
const newSessionButton = document.getElementById('new-session-button');
if (newSessionButton) {
    newSessionButton.addEventListener('click', () => {
        // Reset back to the start/setup state when user requests a new session
        resetSession(false);
    });
}

// ============================================================
// INITIALIZATION
// ============================================================

// Initialize with default 15-second duration
window.handleRestDurationChange('15');

// Set initial status text
setStatusText(INITIAL_INSTRUCTIONS, TIMER_STATE.IDLE);

// Initialize UI state
updateUI(TIMER_STATE.IDLE, 0);
updateSetBoxes();
