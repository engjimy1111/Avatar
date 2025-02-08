import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const MOUTH_SHAPES = {
    'A': 0.9,   // very wide open
    'B': 0.4,   // slightly open
    'C': 0.6,   // medium open
    'D': 0.8,   // more open
    'E': 1.0,   // maximum open
    'X': 0      // closed
};

let isSpeaking = false;
let currentSpeech = null;
let conversationHistory = [];
let currentAudio = null;
let currentLanguage = 'en'; 
let model, headMesh, morphTargets = {};
let rhubarbInstance = null;
let scene, camera, renderer, controls;


// config.js
const config = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    ELEVEN_LABS_API_KEY: process.env.ELEVEN_LABS_API_KEY || '',
    WATSON_CONFIG: {
        apiKey: process.env.WATSON_API_KEY || '',
        assistantId: process.env.WATSON_ASSISTANT_ID || '',
        region: process.env.WATSON_REGION || '',
        serviceUrl: process.env.WATSON_SERVICE_URL || ''
    }
};



// Eye Blinking Mechanism
function setupEyeBlinking(model) {
    const blinkConfigs = [
        {
            type: 'cameraMovement',
            perform: () => {
                const originalPosition = camera.position.clone();
                camera.position.y -= 0.01;
                setTimeout(() => camera.position.copy(originalPosition), 100);
                console.log('Performing camera movement blink');
            }
        },
        {
            type: 'subtleRotation',
            perform: () => {
                const maxRotation = 0.015;
                model.rotation.y += (Math.random() - 0.5) * maxRotation;
                setTimeout(() => {
                    model.rotation.y = 0;
                }, 200);
                console.log('Performing subtle rotation blink');
            }
        }
    ];

    function randomBlinkSimulation() {
        // Randomly choose and perform a blinking technique
        const chosenConfig = blinkConfigs[Math.floor(Math.random() * blinkConfigs.length)];
        chosenConfig.perform();
    }

    const blinkInterval = setInterval(() => {
        if (Math.random() < 0.15) {  // 15% chance of blinking
            randomBlinkSimulation();
        }
    }, 3500);

    return {
        stop: () => {
            clearInterval(blinkInterval);
            // Reset any transformations
            model.rotation.y = 0;
            camera.position.set(
                camera.position.x, 
                camera.position.y, 
                camera.position.z
            );
        }
    };
}

// Expose resetAvatar to global window object
window.resetAvatar = function() {
    // Stop any ongoing speech
    if (isSpeaking) {
        window.stopSpeaking();
    }

    // Clear conversation history
    conversationHistory = [];

    // Clear speech display
    const speechDisplay = document.getElementById("speechDisplay");
    speechDisplay.innerHTML = '';

    // Reset language to default
    if (currentLanguage !== 'en') {
        window.toggleLanguage();
    }

    // Reset text input
    document.getElementById("textInput").value = '';

    // Reset mouth position
    if (headMesh && morphTargets.mouthOpen !== undefined) {
        headMesh.morphTargetInfluences[morphTargets.mouthOpen] = 0;
    }

    // Stop any ongoing lip sync
    if (rhubarbInstance) {
        rhubarbInstance.stop();
        rhubarbInstance = null;
    }

    // Cancel any speech synthesis
    if (currentSpeech) {
        speechSynthesis.cancel();
        currentSpeech = null;
    }

    // Cancel any audio playback
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    // Reset speaking state
    isSpeaking = false;

    // Add a reset message
    displaySpeech("avatar", "Avatar reset. Ready to chat!");
};

window.toggleLanguage = function() {
    currentLanguage = currentLanguage === 'en' ? 'ar' : 'en';
    const toggleButton = document.querySelector('#langToggle');
    toggleButton.textContent = `🌍 ${currentLanguage.toUpperCase()}`;
};

function displaySpeech(speaker, text) {
    const display = document.getElementById("speechDisplay");
    const speechLine = document.createElement("div");
    speechLine.classList.add("speech-line");
    speechLine.classList.add(speaker === "user" ? "user" : "avatar");
    speechLine.innerHTML = `<span>${speaker === "user" ? "You" : "Avatar"}:</span> ${text}`;
    display.appendChild(speechLine);
    display.scrollTop = display.scrollHeight;
}

function setupIdleHeadMovement(model) {
    }


function setupRhubarbLipSync(audioElement, text) {
    // Advanced lip sync configuration
    const LIP_SYNC_CONFIG = {
        SPEED: 0.9,           // Overall speed of lip movement
        RESPONSIVENESS: 0.85, // How quickly mouth reacts to changes
        VARIATION: 0.3,       // Amount of random variation
        CLOSING_SPEED: 0.6    // Speed of returning to closed position
    };

    // State management for precise lip movement
    let lipSyncState = {
        currentIntensity: 0,
        targetIntensity: 0,
        smoothingFactor: LIP_SYNC_CONFIG.SPEED,
        variationFactor: LIP_SYNC_CONFIG.VARIATION
    };

    // Phoneme smoothing cache
    let smoothIntensities = {};

    // Fallback lip sync if Rhubarb is not available
    if (typeof Rhubarb === 'undefined') {
        console.warn('Rhubarb Lip Sync library not loaded. Using fallback lip sync.');
        
        return {
            start: () => {
                if (headMesh && morphTargets.mouthOpen !== undefined) {
                    let animationFrame;
                    
                    const animate = () => {
                        if (!isSpeaking) return;
                        
                        // Hyper-responsive interpolation
                        lipSyncState.currentIntensity += 
                            (lipSyncState.targetIntensity - lipSyncState.currentIntensity) * 
                            lipSyncState.smoothingFactor;
                        
                        // Apply smoothed intensity
                        headMesh.morphTargetInfluences[morphTargets.mouthOpen] = 
                            Math.max(0, Math.min(1, lipSyncState.currentIntensity));
                        
                        // Dynamic target changes
                        if (Math.random() < LIP_SYNC_CONFIG.RESPONSIVENESS * 0.2) {
                            lipSyncState.targetIntensity = 
                                Math.random() * (1 + lipSyncState.variationFactor) - 
                                (lipSyncState.variationFactor / 2);
                        }
                        
                        animationFrame = requestAnimationFrame(animate);
                    };
                    
                    animate();
                    
                    return {
                        stop: () => {
                            cancelAnimationFrame(animationFrame);
                            lipSyncState.targetIntensity = 0;
                            
                            // Rapid mouth closing
                            const closeInterval = setInterval(() => {
                                lipSyncState.currentIntensity *= LIP_SYNC_CONFIG.CLOSING_SPEED;
                                headMesh.morphTargetInfluences[morphTargets.mouthOpen] = 
                                    lipSyncState.currentIntensity;
                                
                                if (lipSyncState.currentIntensity < 0.01) {
                                    clearInterval(closeInterval);
                                    headMesh.morphTargetInfluences[morphTargets.mouthOpen] = 0;
                                }
                            }, 16);
                        }
                    };
                }
                return { stop: () => {} };
            }
        };
    }

    // Rhubarb setup
    const rhubarb = new Rhubarb.Instance();
    
    // Prepare audio and text
    rhubarb.setAudioFile(audioElement);
    rhubarb.setText(text);

    // Advanced phoneme mapping
    rhubarb.onPhonemeEvent = (phoneme) => {
        if (headMesh && morphTargets.mouthOpen !== undefined) {
            // Target intensity with dynamic adjustment
            const baseIntensity = MOUTH_SHAPES[phoneme] || 0;
            
            // Hyper-responsive interpolation
            smoothIntensities[phoneme] = 
                smoothIntensities[phoneme] ? 
                (smoothIntensities[phoneme] * (1 - LIP_SYNC_CONFIG.RESPONSIVENESS) + 
                 baseIntensity * LIP_SYNC_CONFIG.RESPONSIVENESS) : 
                baseIntensity;
            
            // Apply smoothed mouth movement
            headMesh.morphTargetInfluences[morphTargets.mouthOpen] = 
                Math.max(0, Math.min(1, smoothIntensities[phoneme]));
        }
    };

    return rhubarb;
}

// Rest of the existing script remains the same...

// Three.js Scene Setup
function initThreeScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 10);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Lighting
    const light = new THREE.AmbientLight(0xffffff, 1);
    scene.add(light);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    directionalLight.position.set(2, 4, 2);
    scene.add(directionalLight);

    // Orbit Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Load Avatar
    const loader = new GLTFLoader();
    loader.load("avatar.glb", function(gltf) {
        model = gltf.scene;

        // Calculate model size and center
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Position and scale the model
        model.position.set(-center.x, -center.y, -center.z);
        model.position.y += size.y / 2;
        model.position.y -= 0.3;
        model.scale.set(1, 1, 1);
        scene.add(model);

        // Camera and controls positioning
        const headPosition = new THREE.Vector3(0, size.y * 0.75, 0);
        camera.position.set(headPosition.x, headPosition.y, size.z / 0.7);
        camera.lookAt(headPosition);

        controls.target.set(headPosition.x, headPosition.y, headPosition.z);
        controls.update();

        // Find head mesh with morph targets
        headMesh = model.getObjectByName("Wolf3D_Head");
        
        if (headMesh) {
            console.log("Head Mesh Details:", {
                name: headMesh.name,
                morphTargetCount: headMesh.morphTargetInfluences?.length,
                morphTargetNames: Object.keys(headMesh.morphTargetDictionary || {}),
                morphInfluences: Array.from(headMesh.morphTargetInfluences || [])
            });

            // Use the predefined morph target dictionary
            morphTargets = headMesh.morphTargetDictionary || {};
            console.log("Prepared Morph Targets:", morphTargets);

            // Setup eye blinking
            //setupEyeBlinking(headMesh);
            
            // Setup idle head movement
            //setupIdleHeadMovement(model);
        } else {
            console.error("Wolf3D_Head not found!");
        }

        animate();
    });

    // Animation Loop
    function animate() {
        requestAnimationFrame(animate);
        
        // Update orbit controls
        if (controls) {
            controls.update();
        }

        // Render the scene
        renderer.render(scene, camera);
    }

    // Handle window resizing
    window.addEventListener('resize', () => {
        if (camera && renderer) {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });
}

// Add the remaining functions (speakWithElevenLabs, getOpenAIResponse, etc.)
async function speakWithElevenLabs(text) {
    try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "xi-api-key": config.ELEVEN_LABS_API_KEY
            },
            body: JSON.stringify({
                text: text,
                model_id: "eleven_multilingual_v2",
                settings: {
                    stability: 0.5,
                    similarity_boost: 0.8
                }
            })
        });

        if (!response.ok) {
            console.error("Error fetching TTS from ElevenLabs");
            return;
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
        }

        currentAudio = new Audio(audioUrl);

        currentAudio.onplay = function () {
            isSpeaking = true;
            
            // Setup Rhubarb Lip Sync
            rhubarbInstance = setupRhubarbLipSync(currentAudio, text);
            if (rhubarbInstance) {
                rhubarbInstance.start();
            }
        };

        currentAudio.onended = function () {
            isSpeaking = false;
            
            // Stop Rhubarb and reset mouth
            if (rhubarbInstance) {
                rhubarbInstance.stop();
                rhubarbInstance = null;
            }

            if (headMesh && morphTargets.mouthOpen !== undefined) {
                headMesh.morphTargetInfluences[morphTargets.mouthOpen] =0;
            }

            currentAudio = null;
        };

        currentAudio.play();
    } catch (error) {
        console.error("Speech synthesis error:", error);
    }
}

function speakWithNativeTTS(text) {
    if (isSpeaking) {
        speechSynthesis.cancel();
    }

    const speech = new SpeechSynthesisUtterance(text);
    currentSpeech = speech;
    speech.rate = 1;
    speech.pitch = 1;
    speech.volume = 1;

    speech.onstart = function () {
        isSpeaking = true;
        
        // For native TTS, we'll use a simpler lip sync
        const syntheticAudio = new Audio();
        rhubarbInstance = setupRhubarbLipSync(syntheticAudio, text);
        if (rhubarbInstance) {
            rhubarbInstance.start();
        }
    };

    speech.onend = function () {
        isSpeaking = false;
        
        // Stop Rhubarb and reset mouth
        if (rhubarbInstance) {
            rhubarbInstance.stop();
            rhubarbInstance = null;
        }

        if (headMesh && morphTargets.mouthOpen !== undefined) {
            headMesh.morphTargetInfluences[morphTargets.mouthOpen] = 0;
        }
    };

    speechSynthesis.speak(speech);
}

function speak(text) {
    displaySpeech("avatar", text);
    if (currentLanguage === 'ar') {
        speakWithElevenLabs(text);
    } else {
        speakWithNativeTTS(text);
    }
}

window.stopSpeaking = function() {
    if (isSpeaking) {
        if (currentLanguage === 'ar' && currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        } else {
            speechSynthesis.cancel();
        }
        
        // Stop Rhubarb and reset mouth
        if (rhubarbInstance) {
            rhubarbInstance.stop();
            rhubarbInstance = null;
        }

        if (headMesh && morphTargets.mouthOpen !== undefined) {
            headMesh.morphTargetInfluences[morphTargets.mouthOpen] = 0;
        }

        isSpeaking = false;
        displaySpeech("avatar", "Speech stopped.");
    }
};


async function getOpenAIResponse() {
    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${config.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4",
                messages: [
                    {
                        role: "system", 
                        content: currentLanguage === 'ar' 
                            ? "أجب بإيجاز ووضوح. قدم معلومات مركزة ومباشرة في جملة أو جملتين." 
                            : "Respond concisely and clearly. Provide focused, direct information in one or two sentences."
                    },
                    ...conversationHistory
                ],
                max_tokens: 150,  // Reduced to encourage shorter responses
                temperature: 0.7,
                presence_penalty: 0.3,  // Slightly reduce diversity to keep it concise
                frequency_penalty: 0.3
            }),
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            let response = data.choices[0].message.content.trim();
            
            // Ensure the response ends appropriately
            if (currentLanguage === 'ar' && !response.endsWith('.')  && !response.endsWith('!') && !response.endsWith('؟')) {
                response += '.';
            }
            
            return response;
        }
        
        return currentLanguage === 'ar' 
            ? "عذراً، لم أتمكن من تقديم إجابة مختصرة." 
            : "Sorry, I couldn't provide a concise answer.";
    } catch (error) {
        console.error("OpenAI API error:", error);
        return currentLanguage === 'ar' 
            ? "عذراً، حدث خطأ في معالجة طلبك." 
            : "Sorry, there was an error processing your request.";
    }
}

async function processUserInput(inputText) {
    conversationHistory.push({ role: "user", content: inputText });
    displaySpeech("user", inputText);

    const responseText = await getOpenAIResponse();
    conversationHistory.push({ role: "assistant", content: responseText });
    speak(responseText);
}

window.processText = function() {
    const textInput = document.getElementById("textInput").value.trim();
    if (textInput) {
        processUserInput(textInput);
        document.getElementById("textInput").value = "";
    }
};

window.startListening = function() {
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = currentLanguage === 'ar' ? 'ar' : 'en-US';
    recognition.interimResults = false;

    recognition.start();

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript.trim();
        processUserInput(transcript);
    };

    recognition.onerror = function(event) {
        console.error("Speech recognition error:", event.error);
    };
};

window.handleKeyPress = function(event) {
    if (event.key === "Enter") {
        window.processText();
    }
};

// Initialize the Three.js scene when the module loads
initThreeScene();