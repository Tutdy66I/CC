"""
Particle Heart — particles scatter, then converge into a beating heart.
"""
import tkinter as tk
import random
import math

WIDTH, HEIGHT = 800, 700
PARTICLE_COUNT = 300
GRAVITY = 0.03
CENTER_X, CENTER_Y = WIDTH // 2, HEIGHT // 2 - 30

root = tk.Tk()
root.title("Particle Heart")
root.resizable(False, False)
canvas = tk.Canvas(root, width=WIDTH, height=HEIGHT, bg="#0a0a14", highlightthickness=0)
canvas.pack()

# --- Heart curve ---
def heart_point(t, scale=1.0):
    """Parametric heart: x = 16*sin(t)^3, y = -(13*cos(t) - 5*cos(2t) - 2*cos(3t) - cos(4t))"""
    t_rad = math.radians(t)
    x = 16 * math.sin(t_rad) ** 3
    y = -(13 * math.cos(t_rad) - 5 * math.cos(2 * t_rad) - 2 * math.cos(3 * t_rad) - math.cos(4 * t_rad))
    return x * scale, y * scale


# --- Particle ---
class Particle:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.target_x = x
        self.target_y = y
        self.vx = random.uniform(-2, 2)
        self.vy = random.uniform(-2, 2)
        self.size = random.uniform(1.5, 3.5)
        self.base_size = self.size
        # Color: red ~ pink ~ magenta
        r = random.randint(220, 255)
        g = random.randint(20, 120)
        b = random.randint(60, 200)
        self.color = f"#{r:02x}{g:02x}{b:02x}"
        self.angle = random.uniform(0, 2 * math.pi)
        self.orbit_r = random.uniform(0.5, 2.5)
        self.orbit_speed = random.uniform(0.01, 0.04)

    def set_target(self, tx, ty):
        self.target_x = tx
        self.target_y = ty

    def update(self, scale, pulse):
        # Move toward target
        dx = self.target_x - self.x
        dy = self.target_y - self.y
        self.vx += dx * 0.02 + random.uniform(-0.1, 0.1)
        self.vy += dy * 0.02 + random.uniform(-0.1, 0.1)
        self.vx *= 0.92
        self.vy *= 0.92
        self.x += self.vx
        self.y += self.vy

        # Size pulses
        self.size = self.base_size * pulse

    def draw(self):
        r = max(1, int(self.size))
        return canvas.create_oval(
            self.x - r, self.y - r, self.x + r, self.y + r,
            fill=self.color, outline="", tags="particle"
        )


# --- Initialize particles at random positions ---
particles = []
for _ in range(PARTICLE_COUNT):
    x = random.uniform(0, WIDTH)
    y = random.uniform(0, HEIGHT)
    particles.append(Particle(x, y))

# --- Pre-compute heart target points ---
heart_targets = []
for _ in range(PARTICLE_COUNT):
    t = random.uniform(0, 360)
    scale = random.uniform(14, 18)
    hx, hy = heart_point(t, scale)
    heart_targets.append((CENTER_X + hx, CENTER_Y + hy))

# --- State ---
frame = 0
scattered = True
scatter_timer = 0

hint = canvas.create_text(
    WIDTH // 2, HEIGHT - 40,
    text="Click to form heart  |  R to scatter  |  Q to quit",
    fill="#555577", font=("Consolas", 12)
)


def scatter_particles():
    """Scatter particles to random positions."""
    for p, _ in zip(particles, heart_targets):
        p.set_target(random.uniform(50, WIDTH - 50), random.uniform(50, HEIGHT - 50))


def form_heart():
    """Assign each particle its heart target."""
    for p, (hx, hy) in zip(particles, heart_targets):
        p.set_target(hx, hy)


# --- Click to form heart ---
def on_click(event):
    global scattered, scatter_timer
    scattered = False
    scatter_timer = 0
    form_heart()

canvas.bind("<Button-1>", on_click)

# --- Keyboard ---
def on_key(event):
    global scattered, scatter_timer
    if event.keysym.lower() in ("r",):
        scattered = True
        scatter_timer = 0
        scatter_particles()
    elif event.keysym.lower() in ("q",):
        root.destroy()

root.bind("<Key>", on_key)

# --- Stars ---
stars = []
for _ in range(80):
    sx = random.randint(0, WIDTH)
    sy = random.randint(0, HEIGHT // 2)
    sr = random.randint(1, 2)
    sb = random.randint(60, 120)
    star = canvas.create_oval(sx - sr, sy - sr, sx + sr, sy + sr, fill="#ffffff", outline="")
    stars.append((star, sb))


def animate():
    global frame, scattered, scatter_timer

    canvas.delete("particle")

    # If scattered too long, auto-form heart
    if scattered:
        scatter_timer += 1

    # Pulse
    if not scattered:
        pulse = 1.0 + 0.15 * math.sin(frame * 0.05)
    else:
        pulse = 1.0

    scale = 1.0 + 0.03 * math.sin(frame * 0.03)

    for p in particles:
        p.update(scale, pulse)
        p.draw()

    # Star flicker
    for star, b in stars:
        nb = max(30, min(140, b + random.randint(-6, 6)))
        c = f"#{nb:02x}{nb:02x}{min(255, nb + 50):02x}"
        canvas.itemconfig(star, fill=c)

    # Auto-form after scatter
    if scattered and scatter_timer > 180:
        scattered = False
        scatter_timer = 0
        form_heart()

    frame += 1
    root.after(16, animate)


# --- Start ---
scatter_particles()
animate()
root.mainloop()
