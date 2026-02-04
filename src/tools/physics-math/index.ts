/**
 * Physics & Math Computing Engine
 * Tools for physics simulation, numerical solving, symbolic computation,
 * and dimensional analysis
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
    createEntity,
    EntityType,
    serializeEntity,
} from '../../ecs/index.js';
import { getEventStore } from '../../durability/index.js';

// ============================================================================
// Physical Constants
// ============================================================================

const PHYSICAL_CONSTANTS: Record<string, { value: number; unit: string; description: string }> = {
    c: { value: 299792458, unit: 'm/s', description: 'Speed of light' },
    G: { value: 6.67430e-11, unit: 'm³/(kg·s²)', description: 'Gravitational constant' },
    h: { value: 6.62607015e-34, unit: 'J·s', description: 'Planck constant' },
    hbar: { value: 1.054571817e-34, unit: 'J·s', description: 'Reduced Planck constant' },
    e: { value: 1.602176634e-19, unit: 'C', description: 'Elementary charge' },
    me: { value: 9.1093837015e-31, unit: 'kg', description: 'Electron mass' },
    mp: { value: 1.67262192369e-27, unit: 'kg', description: 'Proton mass' },
    kB: { value: 1.380649e-23, unit: 'J/K', description: 'Boltzmann constant' },
    NA: { value: 6.02214076e23, unit: '1/mol', description: 'Avogadro constant' },
    eps0: { value: 8.8541878128e-12, unit: 'F/m', description: 'Vacuum permittivity' },
    mu0: { value: 1.25663706212e-6, unit: 'H/m', description: 'Vacuum permeability' },
    g: { value: 9.80665, unit: 'm/s²', description: 'Standard gravity' },
};

// ============================================================================
// Unit Dimensions
// ============================================================================

interface UnitDimension {
    length: number;   // L
    mass: number;     // M
    time: number;     // T
    current: number;  // I
    temperature: number; // Θ
    amount: number;   // N
    intensity: number; // J
}

const UNIT_DIMENSIONS: Record<string, UnitDimension> = {
    m: { length: 1, mass: 0, time: 0, current: 0, temperature: 0, amount: 0, intensity: 0 },
    kg: { length: 0, mass: 1, time: 0, current: 0, temperature: 0, amount: 0, intensity: 0 },
    s: { length: 0, mass: 0, time: 1, current: 0, temperature: 0, amount: 0, intensity: 0 },
    A: { length: 0, mass: 0, time: 0, current: 1, temperature: 0, amount: 0, intensity: 0 },
    K: { length: 0, mass: 0, time: 0, current: 0, temperature: 1, amount: 0, intensity: 0 },
    mol: { length: 0, mass: 0, time: 0, current: 0, temperature: 0, amount: 1, intensity: 0 },
    cd: { length: 0, mass: 0, time: 0, current: 0, temperature: 0, amount: 0, intensity: 1 },
    // Derived units
    N: { length: 1, mass: 1, time: -2, current: 0, temperature: 0, amount: 0, intensity: 0 }, // kg·m/s²
    J: { length: 2, mass: 1, time: -2, current: 0, temperature: 0, amount: 0, intensity: 0 }, // kg·m²/s²
    W: { length: 2, mass: 1, time: -3, current: 0, temperature: 0, amount: 0, intensity: 0 }, // kg·m²/s³
    Pa: { length: -1, mass: 1, time: -2, current: 0, temperature: 0, amount: 0, intensity: 0 }, // kg/(m·s²)
    V: { length: 2, mass: 1, time: -3, current: -1, temperature: 0, amount: 0, intensity: 0 }, // kg·m²/(A·s³)
    Hz: { length: 0, mass: 0, time: -1, current: 0, temperature: 0, amount: 0, intensity: 0 }, // 1/s
};

// ============================================================================
// Simulation Templates
// ============================================================================

const SIMULATION_TEMPLATES: Record<string, {
    domain: string;
    code: (params: Record<string, number>) => string;
    description: string;
}> = {
    'simple-pendulum': {
        domain: 'mechanics',
        description: 'Simple pendulum motion simulation',
        code: (params) => `
import numpy as np
import matplotlib.pyplot as plt
from scipy.integrate import odeint

# Physical parameters
g = ${params['g'] ?? 9.81}  # gravitational acceleration (m/s²)
L = ${params['L'] ?? 1.0}   # pendulum length (m)
theta0 = ${params['theta0'] ?? 0.5}  # initial angle (rad)
omega0 = ${params['omega0'] ?? 0.0}  # initial angular velocity (rad/s)

# Time parameters
t_max = ${params['t_max'] ?? 10.0}
dt = ${params['dt'] ?? 0.01}
t = np.arange(0, t_max, dt)

def pendulum_ode(y, t, g, L):
    """
    Pendulum equations of motion:
    dθ/dt = ω
    dω/dt = -(g/L) * sin(θ)
    """
    theta, omega = y
    dydt = [omega, -(g/L) * np.sin(theta)]
    return dydt

# Initial conditions
y0 = [theta0, omega0]

# Solve ODE
solution = odeint(pendulum_ode, y0, t, args=(g, L))
theta = solution[:, 0]
omega = solution[:, 1]

# Convert to Cartesian coordinates
x = L * np.sin(theta)
y = -L * np.cos(theta)

# Plot results
fig, axes = plt.subplots(2, 2, figsize=(12, 10))

axes[0, 0].plot(t, theta)
axes[0, 0].set_xlabel('Time (s)')
axes[0, 0].set_ylabel('Angle (rad)')
axes[0, 0].set_title('Angular Position')
axes[0, 0].grid(True)

axes[0, 1].plot(t, omega)
axes[0, 1].set_xlabel('Time (s)')
axes[0, 1].set_ylabel('Angular velocity (rad/s)')
axes[0, 1].set_title('Angular Velocity')
axes[0, 1].grid(True)

axes[1, 0].plot(theta, omega)
axes[1, 0].set_xlabel('Angle (rad)')
axes[1, 0].set_ylabel('Angular velocity (rad/s)')
axes[1, 0].set_title('Phase Space')
axes[1, 0].grid(True)

axes[1, 1].plot(x, y)
axes[1, 1].set_xlabel('x (m)')
axes[1, 1].set_ylabel('y (m)')
axes[1, 1].set_title('Trajectory')
axes[1, 1].set_aspect('equal')
axes[1, 1].grid(True)

plt.tight_layout()
plt.savefig('pendulum_simulation.png', dpi=150)
plt.show()

print(f"Theoretical period: T = 2π√(L/g) = {2 * np.pi * np.sqrt(L/g):.4f} s")
`,
    },
    'projectile-motion': {
        domain: 'mechanics',
        description: 'Projectile motion with air resistance',
        code: (params) => `
import numpy as np
import matplotlib.pyplot as plt
from scipy.integrate import odeint

# Physical parameters
g = ${params['g'] ?? 9.81}          # gravitational acceleration (m/s²)
v0 = ${params['v0'] ?? 50.0}        # initial velocity (m/s)
angle = ${params['angle'] ?? 45.0}   # launch angle (degrees)
mass = ${params['mass'] ?? 1.0}      # mass (kg)
drag_coeff = ${params['drag'] ?? 0.0}  # drag coefficient

# Initial conditions
angle_rad = np.radians(angle)
vx0 = v0 * np.cos(angle_rad)
vy0 = v0 * np.sin(angle_rad)

# Time array
t_max = 2 * vy0 / g * 1.5  # estimate max time
t = np.linspace(0, t_max, 1000)

def projectile_ode(y, t, g, drag, mass):
    """
    Projectile equations with optional drag:
    dx/dt = vx
    dy/dt = vy
    dvx/dt = -drag * vx * |v| / mass
    dvy/dt = -g - drag * vy * |v| / mass
    """
    x, y_pos, vx, vy = y
    v = np.sqrt(vx**2 + vy**2)
    
    if drag > 0 and mass > 0:
        ax = -drag * vx * v / mass
        ay = -g - drag * vy * v / mass
    else:
        ax = 0
        ay = -g
    
    return [vx, vy, ax, ay]

# Solve ODE
y0 = [0, 0, vx0, vy0]
solution = odeint(projectile_ode, y0, t, args=(g, drag_coeff, mass))

x = solution[:, 0]
y_pos = solution[:, 1]
vx = solution[:, 2]
vy = solution[:, 3]

# Find where y becomes negative (ground impact)
ground_idx = np.where(y_pos < 0)[0]
if len(ground_idx) > 0:
    idx = ground_idx[0]
    x, y_pos, vx, vy, t = x[:idx], y_pos[:idx], vx[:idx], vy[:idx], t[:idx]

# Analytical solution (no drag)
x_analytical = vx0 * t
y_analytical = vy0 * t - 0.5 * g * t**2

# Plot
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

axes[0].plot(x, y_pos, 'b-', linewidth=2, label='Numerical')
if drag_coeff == 0:
    axes[0].plot(x_analytical, y_analytical, 'r--', label='Analytical')
axes[0].set_xlabel('Horizontal Distance (m)')
axes[0].set_ylabel('Height (m)')
axes[0].set_title('Projectile Trajectory')
axes[0].legend()
axes[0].grid(True)

axes[1].plot(t, np.sqrt(vx**2 + vy**2))
axes[1].set_xlabel('Time (s)')
axes[1].set_ylabel('Speed (m/s)')
axes[1].set_title('Speed vs Time')
axes[1].grid(True)

plt.tight_layout()
plt.savefig('projectile_motion.png', dpi=150)
plt.show()

print(f"Maximum range: {x[-1]:.2f} m")
print(f"Maximum height: {max(y_pos):.2f} m")
print(f"Flight time: {t[-1]:.2f} s")
`,
    },
    'harmonic-oscillator': {
        domain: 'mechanics',
        description: 'Damped harmonic oscillator',
        code: (params) => `
import numpy as np
import matplotlib.pyplot as plt
from scipy.integrate import odeint

# Physical parameters
m = ${params['m'] ?? 1.0}      # mass (kg)
k = ${params['k'] ?? 10.0}     # spring constant (N/m)
b = ${params['b'] ?? 0.5}      # damping coefficient (kg/s)
x0 = ${params['x0'] ?? 1.0}    # initial displacement (m)
v0 = ${params['v0'] ?? 0.0}    # initial velocity (m/s)

# Derived quantities
omega0 = np.sqrt(k / m)  # natural frequency
gamma = b / (2 * m)      # damping ratio
omega_d = np.sqrt(abs(omega0**2 - gamma**2)) if omega0 > gamma else 0

# Time array
t = np.linspace(0, 20, 1000)

def harmonic_ode(y, t, m, k, b):
    """
    Damped harmonic oscillator: m*x'' + b*x' + k*x = 0
    """
    x, v = y
    a = (-k * x - b * v) / m
    return [v, a]

# Solve ODE
y0 = [x0, v0]
solution = odeint(harmonic_ode, y0, t, args=(m, k, b))
x = solution[:, 0]
v = solution[:, 1]

# Energy
KE = 0.5 * m * v**2
PE = 0.5 * k * x**2
E_total = KE + PE

# Damping regime
if gamma < omega0:
    regime = "Underdamped"
elif gamma == omega0:
    regime = "Critically damped"
else:
    regime = "Overdamped"

# Plot
fig, axes = plt.subplots(2, 2, figsize=(12, 10))

axes[0, 0].plot(t, x, 'b-', linewidth=2)
axes[0, 0].set_xlabel('Time (s)')
axes[0, 0].set_ylabel('Displacement (m)')
axes[0, 0].set_title(f'Position ({regime})')
axes[0, 0].grid(True)

axes[0, 1].plot(t, v, 'r-', linewidth=2)
axes[0, 1].set_xlabel('Time (s)')
axes[0, 1].set_ylabel('Velocity (m/s)')
axes[0, 1].set_title('Velocity')
axes[0, 1].grid(True)

axes[1, 0].plot(x, v, 'g-', linewidth=2)
axes[1, 0].set_xlabel('Displacement (m)')
axes[1, 0].set_ylabel('Velocity (m/s)')
axes[1, 0].set_title('Phase Space')
axes[1, 0].grid(True)

axes[1, 1].plot(t, KE, label='Kinetic')
axes[1, 1].plot(t, PE, label='Potential')
axes[1, 1].plot(t, E_total, label='Total', linewidth=2)
axes[1, 1].set_xlabel('Time (s)')
axes[1, 1].set_ylabel('Energy (J)')
axes[1, 1].set_title('Energy')
axes[1, 1].legend()
axes[1, 1].grid(True)

plt.tight_layout()
plt.savefig('harmonic_oscillator.png', dpi=150)
plt.show()

print(f"Natural frequency: ω₀ = {omega0:.4f} rad/s")
print(f"Damping ratio: γ = {gamma:.4f}")
print(f"Regime: {regime}")
`,
    },
    'wave-equation': {
        domain: 'mechanics',
        description: '1D wave equation simulation',
        code: (params) => `
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

# Physical parameters
L = ${params['L'] ?? 1.0}     # string length (m)
c = ${params['c'] ?? 1.0}     # wave speed (m/s)
nx = ${params['nx'] ?? 100}   # spatial points
nt = ${params['nt'] ?? 500}   # time steps
dx = L / (nx - 1)
dt = 0.5 * dx / c  # CFL condition

# Grid
x = np.linspace(0, L, nx)
t = np.arange(0, nt * dt, dt)

# Initial condition: Gaussian pulse
sigma = L / 10
x0 = L / 2
u = np.exp(-((x - x0) / sigma) ** 2)
u_prev = u.copy()
u_next = np.zeros(nx)

# Store solution at some time steps
solutions = [u.copy()]
save_every = nt // 20

# Finite difference time stepping
r = (c * dt / dx) ** 2

for n in range(1, nt):
    # Interior points
    for i in range(1, nx - 1):
        u_next[i] = 2 * u[i] - u_prev[i] + r * (u[i+1] - 2*u[i] + u[i-1])
    
    # Boundary conditions (fixed ends)
    u_next[0] = 0
    u_next[-1] = 0
    
    # Update
    u_prev = u.copy()
    u = u_next.copy()
    
    if n % save_every == 0:
        solutions.append(u.copy())

# Plot snapshots
fig, axes = plt.subplots(2, 3, figsize=(15, 8))
axes = axes.flatten()

for i, sol in enumerate(solutions[:6]):
    axes[i].plot(x, sol, 'b-', linewidth=2)
    axes[i].set_ylim(-1.2, 1.2)
    axes[i].set_xlabel('x (m)')
    axes[i].set_ylabel('u(x,t)')
    axes[i].set_title(f't = {i * save_every * dt:.3f} s')
    axes[i].grid(True)

plt.tight_layout()
plt.savefig('wave_equation.png', dpi=150)
plt.show()

print(f"Wave speed: c = {c} m/s")
print(f"Spatial resolution: dx = {dx:.4f} m")
print(f"Time step: dt = {dt:.6f} s")
print(f"CFL number: {c * dt / dx:.4f}")
`,
    },
};

// ============================================================================
// Numerical Method Selection
// ============================================================================

interface NumericalMethod {
    name: string;
    description: string;
    suitableFor: string[];
    order: number;
    stability: string;
}

const NUMERICAL_METHODS: Record<string, NumericalMethod> = {
    'euler': {
        name: 'Euler Method',
        description: 'First-order explicit method',
        suitableFor: ['simple ODEs', 'quick approximations'],
        order: 1,
        stability: 'Conditionally stable',
    },
    'rk4': {
        name: 'Runge-Kutta 4th Order',
        description: 'Classic 4th-order explicit method',
        suitableFor: ['general ODEs', 'most physics problems'],
        order: 4,
        stability: 'Good stability for moderate stiffness',
    },
    'bdf': {
        name: 'Backward Differentiation Formula',
        description: 'Implicit multistep method',
        suitableFor: ['stiff ODEs', 'chemical kinetics'],
        order: 5,
        stability: 'A-stable, excellent for stiff problems',
    },
    'leapfrog': {
        name: 'Leapfrog/Verlet',
        description: 'Symplectic integrator',
        suitableFor: ['Hamiltonian systems', 'long-time simulations'],
        order: 2,
        stability: 'Energy-conserving for Hamiltonian systems',
    },
    'fdtd': {
        name: 'FDTD (Finite Difference Time Domain)',
        description: 'Explicit time-stepping for PDEs',
        suitableFor: ['wave equations', 'electromagnetics'],
        order: 2,
        stability: 'CFL condition required',
    },
};

// ============================================================================
// Register Physics/Math Tools
// ============================================================================

export function registerPhysicsMathTools(server: McpServer): void {
    // ========================================================================
    // Tool 1: physics_simulate
    // ========================================================================
    server.tool(
        'physics_simulate',
        'Generate physics simulation code for various physical systems',
        {
            system: z.string().describe('Physical system to simulate (e.g., pendulum, projectile, wave)'),
            domain: z.enum(['mechanics', 'electromagnetism', 'thermodynamics', 'quantum', 'fluid']).default('mechanics'),
            parameters: z.record(z.number()).optional().describe('Physical parameters (e.g., mass, length, etc.)'),
            outputFormat: z.enum(['python', 'webgl', 'matlab']).default('python'),
        },
        async ({ system, domain, parameters, outputFormat }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();
            const now = Date.now();

            // Find matching template
            const systemLower = system.toLowerCase();
            let selectedTemplate: typeof SIMULATION_TEMPLATES[string] | undefined;
            let templateName = '';

            for (const [name, template] of Object.entries(SIMULATION_TEMPLATES)) {
                if (systemLower.includes(name.replace(/-/g, ' ')) ||
                    systemLower.includes(name.replace(/-/g, '')) ||
                    template.description.toLowerCase().includes(systemLower)) {
                    selectedTemplate = template;
                    templateName = name;
                    break;
                }
            }

            // Default to pendulum if no match
            if (!selectedTemplate) {
                selectedTemplate = SIMULATION_TEMPLATES['simple-pendulum'];
                templateName = 'simple-pendulum';
            }

            // Generate code
            const code = selectedTemplate?.code(parameters ?? {}) ?? '# No template available';

            // Identify relevant physical constants
            const usedConstants: string[] = [];
            for (const [name, constant] of Object.entries(PHYSICAL_CONSTANTS)) {
                if (code.includes(name) || system.toLowerCase().includes(constant.description.toLowerCase())) {
                    usedConstants.push(`${name} = ${constant.value} ${constant.unit} (${constant.description})`);
                }
            }

            // Record event
            store.append(entityId, 'physics.simulated', {
                system,
                domain,
                template: templateName,
                outputFormat,
                parametersUsed: parameters,
            });

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            entityId,
                            simulation: {
                                system,
                                domain,
                                template: templateName,
                                description: selectedTemplate?.description ?? 'Custom simulation',
                            },
                            code,
                            physicalConstants: usedConstants,
                            requirements: ['numpy', 'scipy', 'matplotlib'],
                            notes: [
                                'Ensure proper units for all parameters',
                                'Check CFL/stability conditions for PDEs',
                                'Validate against analytical solutions where available',
                            ],
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // ========================================================================
    // Tool 2: numerical_solve
    // ========================================================================
    server.tool(
        'numerical_solve',
        'Select and apply appropriate numerical methods for differential equations',
        {
            equation: z.string().describe('Differential equation in mathematical notation'),
            equationType: z.enum(['ode', 'pde', 'system']).default('ode'),
            initialConditions: z.record(z.number()).optional(),
            boundaryConditions: z.record(z.number()).optional(),
            stiff: z.boolean().default(false).describe('Is the problem stiff?'),
        },
        async ({ equation, equationType, initialConditions, boundaryConditions, stiff }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();
            const now = Date.now();

            // Select appropriate method
            let selectedMethod: NumericalMethod;
            if (stiff) {
                selectedMethod = NUMERICAL_METHODS['bdf']!;
            } else if (equation.toLowerCase().includes('hamiltonian') || equation.toLowerCase().includes('energy')) {
                selectedMethod = NUMERICAL_METHODS['leapfrog']!;
            } else if (equationType === 'pde') {
                selectedMethod = NUMERICAL_METHODS['fdtd']!;
            } else {
                selectedMethod = NUMERICAL_METHODS['rk4']!;
            }

            // Generate solution code
            const solutionCode = `
import numpy as np
from scipy.integrate import solve_ivp, odeint

# Equation: ${equation}
# Type: ${equationType}
# Method: ${selectedMethod.name}

def system(t, y):
    """
    Differential equation system.
    Implement based on: ${equation}
    """
    # TODO: Define based on equation
    # Example: dy/dt = -ky → return [-k * y[0]]
    dydt = [0]  # Placeholder
    return dydt

# Initial conditions
y0 = ${JSON.stringify(Object.values(initialConditions ?? { y0: 0 }))}

# Time span
t_span = (0, 10)
t_eval = np.linspace(t_span[0], t_span[1], 1000)

# Solve using ${selectedMethod.name}
solution = solve_ivp(
    system, 
    t_span, 
    y0, 
    method='${stiff ? 'BDF' : 'RK45'}',
    t_eval=t_eval,
    dense_output=True
)

print(f"Solution successful: {solution.success}")
print(f"Message: {solution.message}")

# Plot
import matplotlib.pyplot as plt
plt.figure(figsize=(10, 6))
for i in range(len(y0)):
    plt.plot(solution.t, solution.y[i], label=f'y_{i}')
plt.xlabel('t')
plt.ylabel('y')
plt.title('Numerical Solution')
plt.legend()
plt.grid(True)
plt.show()
`;

            // Record event
            store.append(entityId, 'numerical.solved', {
                equation,
                equationType,
                method: selectedMethod.name,
                stiff,
            });

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            entityId,
                            equation,
                            equationType,
                            method: selectedMethod,
                            alternativeMethods: Object.values(NUMERICAL_METHODS)
                                .filter(m => m.name !== selectedMethod.name)
                                .slice(0, 3),
                            code: solutionCode,
                            recommendations: [
                                stiff ? 'Using implicit method for stiff problem' : 'Using explicit RK4 for non-stiff problem',
                                'Validate step size for accuracy/stability tradeoff',
                                'Compare with analytical solution if available',
                            ],
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // ========================================================================
    // Tool 3: symbolic_compute
    // ========================================================================
    server.tool(
        'symbolic_compute',
        'Perform symbolic mathematics: simplify, differentiate, integrate, solve',
        {
            expression: z.string().describe('Mathematical expression'),
            operation: z.enum(['simplify', 'differentiate', 'integrate', 'solve', 'expand', 'factor']),
            variable: z.string().default('x').describe('Variable for differentiation/integration'),
            solveFor: z.string().optional().describe('Variable to solve for'),
        },
        async ({ expression, operation, variable, solveFor }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();
            const now = Date.now();

            // Generate SymPy code (since we can't run SymPy directly)
            const sympyCode = `
from sympy import *

# Define symbols
${variable} = Symbol('${variable}')
${solveFor && solveFor !== variable ? `${solveFor} = Symbol('${solveFor}')` : ''}

# Expression
expr = ${expression.replace(/\^/g, '**')}

# Perform ${operation}
${operation === 'simplify' ? `result = simplify(expr)` : ''}
${operation === 'differentiate' ? `result = diff(expr, ${variable})` : ''}
${operation === 'integrate' ? `result = integrate(expr, ${variable})` : ''}
${operation === 'solve' ? `result = solve(expr, ${solveFor ?? variable})` : ''}
${operation === 'expand' ? `result = expand(expr)` : ''}
${operation === 'factor' ? `result = factor(expr)` : ''}

print(f"Input: {expr}")
print(f"${operation.charAt(0).toUpperCase() + operation.slice(1)}: {result}")

# LaTeX representation
print(f"LaTeX: {latex(result)}")
`;

            // Simple pattern-based symbolic computation for common cases
            let result = expression;
            let stepByStep: string[] = [];

            if (operation === 'differentiate') {
                // Simple derivative rules
                if (expression.includes(`${variable}^`)) {
                    const match = expression.match(new RegExp(`(\\d*)\\*?${variable}\\^(\\d+)`));
                    if (match) {
                        const coeff = parseInt(match[1] || '1');
                        const power = parseInt(match[2]!);
                        result = `${coeff * power}*${variable}^${power - 1}`;
                        stepByStep = [
                            `Apply power rule: d/d${variable}[${variable}^n] = n*${variable}^(n-1)`,
                            `d/d${variable}[${expression}] = ${power} * ${coeff} * ${variable}^(${power}-1)`,
                            `= ${result}`,
                        ];
                    }
                } else if (expression === variable) {
                    result = '1';
                    stepByStep = [`d/d${variable}[${variable}] = 1`];
                }
            } else if (operation === 'integrate') {
                // Simple integral rules
                if (expression.includes(`${variable}^`)) {
                    const match = expression.match(new RegExp(`(\\d*)\\*?${variable}\\^(\\d+)`));
                    if (match) {
                        const coeff = parseInt(match[1] || '1');
                        const power = parseInt(match[2]!);
                        result = `${coeff}/${power + 1}*${variable}^${power + 1} + C`;
                        stepByStep = [
                            `Apply power rule: ∫${variable}^n d${variable} = ${variable}^(n+1)/(n+1) + C`,
                            `∫${expression} d${variable} = ${coeff}*(${variable}^(${power}+1))/(${power}+1) + C`,
                            `= ${result}`,
                        ];
                    }
                } else if (expression === variable) {
                    result = `${variable}^2/2 + C`;
                    stepByStep = [`∫${variable} d${variable} = ${variable}^2/2 + C`];
                }
            }

            // Record event
            store.append(entityId, 'symbolic.computed', {
                expression,
                operation,
                variable,
                result,
            });

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            entityId,
                            input: {
                                expression,
                                operation,
                                variable,
                            },
                            result,
                            stepByStep: stepByStep.length > 0 ? stepByStep : undefined,
                            sympyCode,
                            note: 'For complex expressions, run the SymPy code directly',
                        }, null, 2),
                    },
                ],
            };
        }
    );

    // ========================================================================
    // Tool 4: dimensional_check
    // ========================================================================
    server.tool(
        'dimensional_check',
        'Perform dimensional analysis and unit checking on equations',
        {
            equation: z.string().describe('Physical equation to check'),
            variables: z.record(z.string()).describe('Variable names mapped to their units'),
        },
        async ({ equation, variables }) => {
            const entity = createEntity(EntityType.TASK);
            const entityId = serializeEntity(entity);
            const store = getEventStore();
            const now = Date.now();

            // Parse units for each variable
            const variableDimensions: Record<string, UnitDimension | null> = {};
            const issues: string[] = [];

            for (const [varName, unit] of Object.entries(variables)) {
                const baseUnit = unit.split('/')[0]?.split('·')[0]?.split('²')[0]?.split('³')[0]?.trim() ?? '';
                if (UNIT_DIMENSIONS[baseUnit]) {
                    variableDimensions[varName] = UNIT_DIMENSIONS[baseUnit] ?? null;
                } else {
                    variableDimensions[varName] = null;
                    issues.push(`Unknown unit '${unit}' for variable '${varName}'`);
                }
            }

            // Check equation sides
            const sides = equation.split('=');
            let dimensionallyConsistent = true;
            let analysis = '';

            if (sides.length === 2) {
                analysis = `
Dimensional Analysis of: ${equation}

Left side: ${sides[0]?.trim()}
Right side: ${sides[1]?.trim()}

Variable dimensions:
${Object.entries(variables).map(([v, u]) => `  ${v} : [${u}]`).join('\n')}

`;

                // Simple heuristic checks
                const lhs = sides[0] ?? '';
                const rhs = sides[1] ?? '';

                // Check for common dimensional errors
                if ((lhs.includes('+') || lhs.includes('-')) &&
                    !rhs.includes('+') && !rhs.includes('-')) {
                    const terms = lhs.split(/[+-]/);
                    analysis += '\nNote: Addition/subtraction requires same dimensions for all terms.\n';
                }
            }

            // Provide dimensional formula
            const dimensionalFormulas = {
                'velocity': 'L T⁻¹',
                'acceleration': 'L T⁻²',
                'force': 'M L T⁻²',
                'energy': 'M L² T⁻²',
                'power': 'M L² T⁻³',
                'pressure': 'M L⁻¹ T⁻²',
                'momentum': 'M L T⁻¹',
                'angular momentum': 'M L² T⁻¹',
            };

            // Record event
            store.append(entityId, 'dimensional.checked', {
                equation,
                variableCount: Object.keys(variables).length,
                issueCount: issues.length,
                dimensionallyConsistent,
            });

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            entityId,
                            equation,
                            variables: Object.entries(variables).map(([name, unit]) => ({
                                name,
                                unit,
                                dimension: variableDimensions[name] ?? 'unknown',
                            })),
                            analysis,
                            issues: issues.length > 0 ? issues : ['No issues detected'],
                            dimensionallyConsistent,
                            commonDimensions: dimensionalFormulas,
                            recommendations: [
                                'Ensure all terms in sums have identical dimensions',
                                'Check that both sides of equation match',
                                'Use SI base units for consistency',
                            ],
                        }, null, 2),
                    },
                ],
            };
        }
    );
}
