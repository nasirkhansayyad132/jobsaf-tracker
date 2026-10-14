import { cn } from '../lib/utils';
import { getAvatarTone, getCompanyInitials } from '../lib/jobs';

/** Monogram avatar with a colour that stays the same for each employer. */
export function CompanyAvatar({ name, size = 'md', className }) {
    return (
        <span
            className={cn('company-avatar', `company-avatar-${size}`, `avatar-tone-${getAvatarTone(name)}`, className)}
            aria-hidden="true"
        >
            {getCompanyInitials(name)}
        </span>
    );
}
