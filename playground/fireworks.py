"""
🎆 点哪放哪的烟花！
Click anywhere to launch fireworks!
"""
import tkinter as tk
import random
import math
import colorsys

# ── 窗口 ──
WIDTH, HEIGHT = 1000, 700
root = tk.Tk()
root.title("🎆 Fireworks — Click to Launch!")
root.resizable(False, False)
canvas = tk.Canvas(root, width=WIDTH, height=HEIGHT, bg="#0a0a14", highlightthickness=0)
canvas.pack()

# ── 星空背景 ──
stars = []
for _ in range(120):
    x, y = random.randint(0, WIDTH), random.randint(0, HEIGHT // 2)
    r = random.randint(1, 2)
    b = random.randint(40, 100)
    s = canvas.create_oval(x - r, y - r, x + r, y + r, fill="#ffffff", outline="")
    stars.append((s, b))

GRAVITY = 0.15
TRAIL_LENGTH = 8

# ── 烟花粒子 ──
class Particle:
    def __init__(self, x, y, color, speed, angle, life, size=2.5):
        self.x = x
        self.y = y
        self.vx = math.cos(angle) * speed
        self.vy = math.sin(angle) * speed
        self.color = color
        self.life = life
        self.max_life = life
        self.size = size

    def update(self):
        self.vy += GRAVITY
        self.x += self.vx
        self.y += self.vy
        self.vx *= 0.99
        self.life -= 1
        return self.life > 0

    def draw(self):
        ratio = self.life / self.max_life
        r = int(self.size * ratio)
        if r < 1:
            r = 1
        alpha = ratio
        r_int = min(255, int(int(self.color[1:3], 16) * alpha + 10 * (1 - alpha)))
        g_int = min(255, int(int(self.color[3:5], 16) * alpha + 10 * (1 - alpha)))
        b_int = min(255, int(int(self.color[5:7], 16) * alpha + 20 * (1 - alpha)))
        fill = f"#{r_int:02x}{g_int:02x}{b_int:02x}"
        return canvas.create_oval(
            self.x - r, self.y - r, self.x + r, self.y + r,
            fill=fill, outline="", tags="firework"
        )

# ── 火箭（上升阶段） ──
class Rocket:
    def __init__(self, start_x, start_y, target_x, target_y):
        self.x = start_x
        self.y = start_y
        self.target_x = target_x
        self.target_y = target_y
        self.trail = []
        self.alive = True
        self.color = random.choice(FIREWORK_COLORS)
        # 计算速度方向
        dx, dy = target_x - start_x, target_y - start_y
        dist = math.sqrt(dx**2 + dy**2)
        speed = random.uniform(8, 14)
        self.vx = dx / dist * speed
        self.vy = dy / dist * speed

    def update(self):
        self.trail.append((self.x, self.y))
        if len(self.trail) > TRAIL_LENGTH:
            self.trail.pop(0)
        self.x += self.vx
        self.y += self.vy
        # 到达目标附近就爆炸
        if abs(self.x - self.target_x) < 15 and abs(self.y - self.target_y) < 15:
            self.alive = False
            return "explode"
        # 如果超过目标还没爆（比如速度太快跳过），强制爆
        if (self.vy > 0 and self.y > self.target_y) or self.y < 0:
            self.alive = False
            return "explode"
        return None

    def draw(self):
        items = []
        # 画尾迹
        for i, (tx, ty) in enumerate(self.trail):
            alpha = i / len(self.trail)
            r = int(2 * alpha)
            if r < 1: r = 1
            items.append(canvas.create_oval(
                tx - r, ty - r, tx + r, ty + r,
                fill=self.color, outline="", tags="firework"
            ))
        # 画火箭头
        items.append(canvas.create_oval(
            self.x - 3, self.y - 3, self.x + 3, self.y + 3,
            fill="#ffffff", outline="", tags="firework"
        ))
        return items

# ── 随机颜色 ──
FIREWORK_COLORS = [
    "#ff4444", "#ff6644", "#ff8844", "#ffaa22", "#ffcc00",
    "#ff4488", "#ff44aa", "#ee44ff", "#aa44ff", "#6644ff",
    "#4488ff", "#44ccff", "#44ffcc", "#44ff88", "#44ff44",
    "#88ff44", "#ccff44", "#ffff44",
]

def random_firework_color():
    h = random.random()
    r, g, b = colorsys.hsv_to_rgb(h, 0.9, 1.0)
    return f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"

# ── 爆炸效果 ──
def explode(x, y, parent_color=None):
    """在 (x, y) 生成爆炸粒子"""
    color = parent_color if parent_color else random_firework_color()
    particles = []
    count = random.randint(60, 120)

    # 主爆炸 — 圆形扩散
    for _ in range(count):
        angle = random.uniform(0, 2 * math.pi)
        speed = random.uniform(1.5, 8.0)
        life = random.randint(25, 55)
        size = random.uniform(1.5, 3.5)
        p = Particle(x, y, color, speed, angle, life, size)
        particles.append(p)

    # 内圈亮点
    for _ in range(count // 3):
        angle = random.uniform(0, 2 * math.pi)
        speed = random.uniform(0.5, 3.0)
        life = random.randint(15, 30)
        p = Particle(x, y, "#ffffff", speed, angle, life, 2.0)
        particles.append(p)

    return particles

# ── 全局状态 ──
rockets = []       # 飞行中的火箭
particles = []     # 所有爆炸粒子
click_count = 0

# ── 鼠标点击 → 发射火箭 ──
def on_click(event):
    global click_count
    click_count += 1
    target_x = event.x
    target_y = event.y
    # 从底部随机位置发射
    start_x = random.randint(100, WIDTH - 100)
    start_y = HEIGHT - 20
    rocket = Rocket(start_x, start_y, target_x, target_y)
    rocket.color = random_firework_color()
    rockets.append(rocket)

canvas.bind("<Button-1>", on_click)

# ── 键盘发射 ──
def on_space(event):
    # 从底部中央发射到随机高空
    target_x = random.randint(150, WIDTH - 150)
    target_y = random.randint(50, HEIGHT // 3)
    start_x = random.randint(200, WIDTH - 200)
    rocket = Rocket(start_x, HEIGHT - 20, target_x, target_y)
    rocket.color = random_firework_color()
    rockets.append(rocket)

root.bind("<space>", on_space)

# ── 显示提示 ──
hint = canvas.create_text(
    WIDTH // 2, HEIGHT - 60,
    text="🖱️  Click anywhere to launch fireworks!  |  [Space] for random launch",
    fill="#666688", font=("Microsoft YaHei", 14)
)

# ── 主循环 ──
def animate():
    canvas.delete("firework")

    # 更新火箭
    new_explosions = []
    for rocket in rockets[:]:
        result = rocket.update()
        rocket.draw()
        if result == "explode":
            new_explosions.append((rocket.x, rocket.y, rocket.color))
            rockets.remove(rocket)

    # 生成爆炸粒子
    for ex, ey, color in new_explosions:
        particles.extend(explode(ex, ey, color))

    # 更新&绘制粒子
    for p in particles[:]:
        if p.update():
            p.draw()
        else:
            particles.remove(p)

    # 星星闪烁
    for i, (s, brightness) in enumerate(stars):
        new_b = max(30, min(120, brightness + random.randint(-5, 5)))
        stars[i] = (s, new_b)
        c = f"#{new_b:02x}{new_b:02x}{new_b + 30:02x}"
        canvas.itemconfig(s, fill=c)

    # 点击计数
    if click_count > 0:
        hint_text = f"🎆 {click_count} fireworks launched! Keep clicking..."
        canvas.itemconfig(hint, text=hint_text)

    root.after(16, animate)  # ~60fps

animate()
root.mainloop()
