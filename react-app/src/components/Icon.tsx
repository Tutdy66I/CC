interface IconProps {
  name: 'claude-icon' | 'bluesky-icon' | 'discord-icon' | 'documentation-icon' | 'github-icon' | 'social-icon' | 'x-icon'
  size?: number
  className?: string
}

export default function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <use href={`/icons.svg#${name}`} />
    </svg>
  )
}
