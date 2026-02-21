// ====================== MOBILE MENU TOGGLE ======================
const toggleBtn = document.getElementById("navToggle");
const navMenu   = document.getElementById("nav");

if (toggleBtn && navMenu) {
    toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();                    // Prevent click from bubbling to document
        navMenu.classList.toggle("show");

        // Change icon: hamburger → X and back
        toggleBtn.textContent = navMenu.classList.contains("show") ? "✕" : "☰";
    });
}

// Close menu when clicking anywhere outside the menu or toggle button
document.addEventListener("click", (e) => {
    if (navMenu && toggleBtn &&
        !navMenu.contains(e.target) &&
        !toggleBtn.contains(e.target)) {
        
        navMenu.classList.remove("show");
        toggleBtn.textContent = "☰";
    }
});


// ====================== COUNTRY SELECTOR DROPDOWN ======================
const countryBtn = document.getElementById("countryBtn");
const countryMenu = document.getElementById("countryMenu");
const countryNameEl = document.getElementById("countryName");
const countryFlagEl = document.getElementById("countryFlag");

if (countryBtn && countryMenu) {
    countryBtn.addEventListener("click", (e) => {
        e.stopPropagation();                    // Prevent closing immediately
        countryMenu.style.display = 
            countryMenu.style.display === "block" ? "none" : "block";
    });

    // Close country menu when clicking outside
    document.addEventListener("click", (e) => {
        if (!countryBtn.contains(e.target) && !countryMenu.contains(e.target)) {
            countryMenu.style.display = "none";
        }
    });
}

function selectCountry(name, flag) {
    if (countryNameEl) countryNameEl.textContent = name;
    if (countryFlagEl) countryFlagEl.src = flag;
    if (countryMenu) countryMenu.style.display = "none";
}


// ====================== AUTO COUNTRY DETECTION ======================
function autoDetectCountry() {
    fetch('https://ipapi.co/json/')
        .then(response => {
            if (!response.ok) throw new Error('Network error');
            return response.json();
        })
        .then(data => {
            console.log('Detected country:', data.country_name);
            
            if (data.country_name === 'Ghana') {
                selectCountry('Ghana', 'https://upload.wikimedia.org/wikipedia/commons/1/19/Flag_of_Ghana.svg');
            } 
            // Default or any other country → Nigeria
            else {
                console.log('Using default: Nigeria');
                // Optional: explicitly set Nigeria if you want to be sure
                // selectCountry('Nigeria', 'https://upload.wikimedia.org/wikipedia/commons/7/79/Flag_of_Nigeria.svg');
            }
        })
        .catch(err => {
            console.log('IP detection failed → default Nigeria', err);
        });
}


// ====================== CITY SELECT DROPDOWNS ======================
const cities = [
    "New York", "Los Angeles", "Chicago", "Miami",
    "London", "Paris", "Dubai", "Doha",
    "Tokyo", "Singapore", "Hong Kong",
    "Delhi", "Mumbai", "Bangalore",
    "Sydney", "Melbourne", "Toronto"
];

const fromCity = document.getElementById("fromCity");
const toCity   = document.getElementById("toCity");

if (fromCity && toCity) {
    cities.forEach(city => {
        fromCity.innerHTML += `<option>${city}</option>`;
        toCity.innerHTML   += `<option>${city}</option>`;
    });
} else {
    console.warn("City select elements not found");
}

function bookJet() {
    if (fromCity && toCity) {
        alert(`✈️ Flight booked from ${fromCity.value} to ${toCity.value}!`);
    } else {
        alert("✈️ Booking feature not available on this page");
    }
}


// ====================== PRELOADER ======================
document.addEventListener('DOMContentLoaded', function() {
    window.addEventListener('load', function() {
        setTimeout(() => {
            const preloader = document.querySelector('.preloader');
            if (preloader) {
                preloader.classList.add('hidden');
                setTimeout(() => preloader.remove(), 900);
            }
        }, 3500);
    });
});


// ====================== SCROLL FADE-UP ANIMATION ======================
document.addEventListener('DOMContentLoaded', () => {
    const fadeElements = document.querySelectorAll('.fade-up');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });

    fadeElements.forEach(el => observer.observe(el));
});


// ====================== OTHER BUTTONS / PLACEHOLDERS ======================
document.querySelectorAll(".arrow-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        alert("Redirecting to aircraft details...");
    });
});

document.getElementById("fleetBtn")?.addEventListener("click", () => {
    alert("Opening full fleet page...");
});


// ====================== START AUTO-DETECTION ON LOAD ======================
document.addEventListener('DOMContentLoaded', autoDetectCountry);