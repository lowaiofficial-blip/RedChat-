import React, { useState } from 'react';

interface UserAvatarProps {
  photoURL?: string | null;
  name?: string;
  username?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  shape?: 'circle' | 'rounded';
}

const sizeClasses = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-xs font-bold',
  lg: 'w-11 h-11 text-sm font-bold',
  xl: 'w-14 h-14 text-base font-black',
  '2xl': 'w-20 h-20 text-2xl font-black',
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  photoURL,
  name,
  username,
  size = 'md',
  className = '',
  shape = 'circle',
}) => {
  const [imgError, setImgError] = useState(false);

  // Doğrulanmış geçerli resim URL'si
  const validPhotoURL = React.useMemo(() => {
    if (!photoURL || typeof photoURL !== 'string') return null;
    const trimmed = photoURL.trim();
    if (
      trimmed === '' ||
      trimmed === 'null' ||
      trimmed === 'undefined' ||
      trimmed === '[object Object]'
    ) {
      return null;
    }
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:image/') ||
      trimmed.startsWith('blob:')
    ) {
      return trimmed;
    }
    return null;
  }, [photoURL]);

  // photoURL değiştiğinde imgError state'ini sıfırla
  React.useEffect(() => {
    setImgError(false);
  }, [validPhotoURL]);

  // İsim ve kullanıcı adı temizleme
  const cleanName =
    name && typeof name === 'string' && name !== 'undefined' && name !== 'null'
      ? name.trim()
      : '';
  const cleanUsername =
    username && typeof username === 'string' && username !== 'undefined' && username !== 'null'
      ? username.trim()
      : '';

  const initial =
    cleanName.charAt(0).toUpperCase() ||
    cleanUsername.charAt(0).toUpperCase() ||
    'U';

  const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded-2xl';
  const sizeClass = sizeClasses[size] || sizeClasses.md;

  if (validPhotoURL && !imgError) {
    return (
      <div
        className={`relative overflow-hidden shrink-0 bg-gradient-to-br from-red-600 to-red-700 flex items-center justify-center ${shapeClass} ${sizeClass} ${className}`}
      >
        <img
          src={validPhotoURL}
          alt={cleanName || cleanUsername || 'Avatar'}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`shrink-0 bg-gradient-to-br from-red-600 to-red-700 text-white font-bold flex items-center justify-center shadow-xs select-none ${shapeClass} ${sizeClass} ${className}`}
    >
      {initial}
    </div>
  );
};
