import { Drawer, IconButton, useMediaQuery } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Side to slide from on tablets and desktops. */
  side?: 'left' | 'right';
  width?: number;
}

/** A bottom sheet on phones, a side panel on larger screens. */
export function Sheet({ open, onClose, title, children, side = 'right', width = 400 }: Props) {
  const phone = useMediaQuery('(max-width:640px)');
  return (
    <Drawer
      anchor={phone ? 'bottom' : side}
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: phone
            ? { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85vh' }
            : { width, maxWidth: '92vw', borderRadius: 0 },
        },
      }}
    >
      {phone && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted/40" />}
      <div className="safe-top flex items-center justify-between px-5 pt-3 pb-1">
        <div className="font-serif text-lg font-semibold">{title}</div>
        <IconButton onClick={onClose} aria-label="Close" edge="end">
          <CloseRounded />
        </IconButton>
      </div>
      <div className="safe-bottom overflow-y-auto px-5 pb-5">{children}</div>
    </Drawer>
  );
}
